import { and, asc, desc, eq, gt, ilike, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor, type Tx } from "../../db";
import {
  programMemberships,
  reportAttachments,
  programScopes,
  reports,
  reportEvents,
  reportComments,
  programs,
  scoreEvents,
} from "../../db/schema";
import { guestProgramFilter, guestReporterId } from "../guest-reports";
import { cvssScore } from "../cvss";
import {
  canTransition,
  severities,
  transitions,
  type Status,
} from "../workflow";

const uuid = z.uuid();
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\0"));
export const reportInput = z.object({
  assetId: uuid,
  title: text(200),
  description: text(12000),
  cwe: z.string().regex(/^CWE-[1-9][0-9]{0,4}$/),
  steps: text(12000),
  proofOfConcept: text(512 * 1024),
  impact: text(12000),
  proposedSeverity: z.enum(severities),
});

export const commentInput = z.object({
  body: text(5000),
  internal: z.boolean().default(false),
});
const statuses = Object.keys(transitions) as [Status, ...Status[]];
const cvssVector = z.string().trim().max(512).nullable().optional();
export const severityInput = z.object({
  severity: z.enum(severities),
  cvssVector,
});
export const transitionInput = severityInput.partial().extend({
  status: z.enum(statuses),
  duplicateOf: uuid.optional(),
});
export const assignmentInput = z.object({ assigneeId: uuid.nullable() });
export const scoreCorrectionInput = z.object({
  points: z
    .number()
    .int()
    .min(-999999)
    .max(999999)
    .refine((value) => value !== 0),
  reason: text(500),
});
export const reportListInput = z.object({
  view: z.enum(["mine", "inbox", "all"]).default("all"),
  programId: uuid.optional(),
  status: z.enum(statuses).optional(),
  severity: z.enum(severities).optional(),
  search: z
    .string()
    .trim()
    .max(200)
    .refine((value) => !value.includes("\0"))
    .optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  cursor: z.number().int().positive().max(2147483647).optional(),
  limit: z.number().int().positive().max(100).default(30),
});

export class ReportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const unavailable = () => new ReportError(404, "not-found");

export async function createReport(
  actor: string,
  programId: string,
  input: unknown,
) {
  uuid.parse(programId);
  const data = reportInput.parse(input);
  return withActor(actor, async (tx) => {
    const [program] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(
        and(
          eq(programs.id, programId),
          sql`app_can_submit(${programs.id})`,
          actor === guestReporterId ? guestProgramFilter() : undefined,
        ),
      );
    if (!program) throw unavailable();
    const [asset] = await tx
      .select({ id: programScopes.id })
      .from(programScopes)
      .where(
        and(
          eq(programScopes.id, data.assetId),
          eq(programScopes.programId, programId),
          eq(programScopes.inScope, true),
        ),
      );
    if (!asset) throw unavailable();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor}))`);
    const recent = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, actor),
          sql`${reports.createdAt} > now() - interval '1 hour'`,
        ),
      )
      .limit(10);
    if (recent.length >= 10) throw new ReportError(429, "rate-limit");
    const [report] = await tx
      .insert(reports)
      .values({ ...data, programId, reporterId: actor })
      .returning({ id: reports.id });
    await tx.insert(reportEvents).values({
      reportId: report.id,
      actorId: actor,
      kind: "submitted",
      details: {},
    });
    return report;
  });
}

export async function addComment(
  actor: string,
  reportId: string,
  input: unknown,
) {
  uuid.parse(reportId);
  const { body, internal } = commentInput.parse(input);
  return withActor(actor, async (tx) => {
    const [report] = await tx
      .select({
        id: reports.id,
        redacted: reports.contentRedactedAt,
        reviewer: sql<boolean>`app_reviews_program(${reports.programId})`,
      })
      .from(reports)
      .where(eq(reports.id, reportId));
    if (!report || report.redacted || (internal && !report.reviewer))
      throw unavailable();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor}), 2)`);
    const recent = await tx
      .select({ id: reportComments.id })
      .from(reportComments)
      .where(
        and(
          eq(reportComments.authorId, actor),
          sql`${reportComments.createdAt} > now() - interval '1 minute'`,
        ),
      )
      .limit(15);
    if (recent.length >= 15) throw new ReportError(429, "comment-limit");
    const [entry] = await tx
      .insert(reportComments)
      .values({ reportId, authorId: actor, body, internal })
      .returning();
    await tx.insert(reportEvents).values({
      reportId,
      actorId: actor,
      kind: "commented",
      internal,
      details: {},
    });
    return entry;
  });
}

export async function transitionReport(
  actor: string,
  reportId: string,
  input: unknown,
) {
  uuid.parse(reportId);
  const {
    status: target,
    severity,
    duplicateOf,
    cvssVector: vector,
  } = transitionInput.parse(input);
  const score = vector ? cvssScore(vector) : null;
  if (vector && score === null) throw new ReportError(422, "cvss");
  return withActor(actor, async (tx) => {
    const [report] = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, reportId),
          sql`app_reviews_program(${reports.programId})`,
        ),
      )
      .for("update");
    if (!report || report.contentRedactedAt) throw unavailable();
    if (!canTransition(report.status, target))
      throw new ReportError(409, "transition");
    if (target === "validated" && !severity)
      throw new ReportError(422, "severity");
    if (target === "duplicate") {
      if (!duplicateOf || duplicateOf === reportId)
        throw new ReportError(422, "duplicate");
      const [duplicate] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.id, duplicateOf),
            eq(reports.programId, report.programId),
          ),
        );
      if (!duplicate) throw new ReportError(422, "duplicate");
    }
    await tx
      .update(reports)
      .set({
        status: target,
        severity: severity ?? report.severity,
        cvssVector: vector === undefined ? report.cvssVector : vector || null,
        cvssScore: vector === undefined ? report.cvssScore : score,
        duplicateOfId: target === "duplicate" ? duplicateOf : null,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, reportId));
    if (
      target === "validated" &&
      severity &&
      report.reporterId !== guestReporterId
    ) {
      const [program] = await tx
        .select({ scoring: programs.scoring })
        .from(programs)
        .where(eq(programs.id, report.programId));
      const points = z
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(program.scoring[severity]);
      await tx
        .insert(scoreEvents)
        .values({
          reportId,
          programId: report.programId,
          userId: report.reporterId,
          actorId: actor,
          kind: "award",
          points,
          reason: "Report validated",
        })
        .onConflictDoNothing();
    }
    await tx.insert(reportEvents).values({
      reportId,
      actorId: actor,
      kind:
        target === "validated" ? "report.validated" : "report.status_changed",
      details: { from: report.status, to: target },
    });
  });
}

export async function correctReportScore(
  actor: string,
  reportId: string,
  input: unknown,
) {
  uuid.parse(reportId);
  const data = scoreCorrectionInput.parse(input);
  return withActor(actor, async (tx) => {
    const [report] = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, reportId),
          sql`app_manages_program(${reports.programId})`,
        ),
      )
      .for("update");
    if (!report || report.contentRedactedAt) throw unavailable();
    const [award] = await tx
      .select({ id: scoreEvents.id })
      .from(scoreEvents)
      .where(
        and(eq(scoreEvents.reportId, reportId), eq(scoreEvents.kind, "award")),
      );
    if (!award) throw new ReportError(409, "score");
    await tx.insert(scoreEvents).values({
      reportId,
      programId: report.programId,
      userId: report.reporterId,
      actorId: actor,
      kind: "correction",
      ...data,
    });
    await tx.insert(reportEvents).values({
      reportId,
      actorId: actor,
      kind: "report.score_corrected",
      details: data,
    });
  });
}

export async function assignReport(
  actor: string,
  reportId: string,
  input: unknown,
) {
  uuid.parse(reportId);
  const { assigneeId } = assignmentInput.parse(input);
  return withActor(actor, async (tx) => {
    const [report] = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, reportId),
          sql`app_reviews_program(${reports.programId})`,
        ),
      )
      .for("update");
    if (!report || report.contentRedactedAt) throw unavailable();
    if (assigneeId) {
      const [eligible] = await tx
        .select({ id: programMemberships.userId })
        .from(programMemberships)
        .where(
          and(
            eq(programMemberships.programId, report.programId),
            eq(programMemberships.userId, assigneeId),
            inArray(programMemberships.role, ["manager", "triager"]),
          ),
        );
      if (!eligible) throw new ReportError(422, "assignee");
    }
    await tx
      .update(reports)
      .set({ assigneeId, updatedAt: new Date() })
      .where(eq(reports.id, reportId));
    await tx.insert(reportEvents).values({
      reportId,
      actorId: actor,
      kind: "report.assigned",
      internal: true,
      details: { assigneeId },
    });
  });
}

export async function setReportSeverity(
  actor: string,
  reportId: string,
  input: unknown,
) {
  uuid.parse(reportId);
  const { severity, cvssVector: vector } = severityInput.parse(input);
  const score = vector ? cvssScore(vector) : null;
  if (vector && score === null) throw new ReportError(422, "cvss");

  return withActor(actor, async (tx) => {
    const [report] = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, reportId),
          sql`app_reviews_program(${reports.programId})`,
        ),
      )
      .for("update");
    if (!report || report.contentRedactedAt) throw unavailable();
    await tx
      .update(reports)
      .set({
        severity,
        ...(vector !== undefined && {
          cvssVector: vector || null,
          cvssScore: score,
        }),
        updatedAt: new Date(),
      })
      .where(eq(reports.id, reportId));
    await tx.insert(reportEvents).values({
      reportId,
      actorId: actor,
      kind: "report.severity_changed",
      details: { from: report.severity, to: severity },
    });
  });
}

export async function listReports(
  actor: string,
  input: z.input<typeof reportListInput>,
) {
  const { view, programId, status, severity, search, sort, cursor, limit } =
    reportListInput.parse(input);
  const oldest = sort === "oldest";
  const rows = await withActor(actor, (tx) =>
    tx
      .select({
        id: reports.id,
        number: reports.number,
        title: reports.title,
        status: reports.status,
        programId: reports.programId,
        program: programs.name,
        createdAt: reports.createdAt,
        severity: sql<string>`coalesce(${reports.severity}, ${reports.proposedSeverity})`,
      })
      .from(reports)
      .leftJoin(programs, eq(reports.programId, programs.id))
      .where(
        and(
          view === "mine"
            ? eq(reports.reporterId, actor)
            : view === "inbox"
              ? sql`app_reviews_program(${reports.programId})`
              : undefined,
          programId ? eq(reports.programId, programId) : undefined,
          status && eq(reports.status, status),
          severity &&
            sql`coalesce(${reports.severity}, ${reports.proposedSeverity}) = ${severity}`,
          search
            ? ilike(reports.title, `%${search.replace(/[\\%_]/g, "\\$&")}%`)
            : undefined,
          cursor ? (oldest ? gt : lt)(reports.number, cursor) : undefined,
        ),
      )
      .orderBy((oldest ? asc : desc)(reports.number))
      .limit(limit + 1),
  );
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1].number : null,
  };
}

export async function readReport(tx: Tx, id: string) {
  uuid.parse(id);
  const [row] = await tx
    .select({
      report: reports,
      reviewer: sql<boolean>`app_reviews_program(${reports.programId})`,
      manager: sql<boolean>`app_manages_program(${reports.programId})`,
    })
    .from(reports)
    .where(eq(reports.id, id));
  if (!row) throw unavailable();
  return row;
}

export function getReport(actor: string, id: string) {
  return withActor(actor, async (tx) => {
    const { report, reviewer, manager } = await readReport(tx, id);
    return {
      ...report,
      assigneeId: reviewer ? report.assigneeId : null,
      duplicateOfId: reviewer ? report.duplicateOfId : null,
      permissions: { review: reviewer, manage: manager },
    };
  });
}

export const reportCollectionInput = z.object({
  limit: z.number().int().positive().max(100).default(30),
  cursor: uuid.optional(),
});

function reportCollection(
  actor: string,
  id: string,
  table: typeof reportComments | typeof reportEvents | typeof reportAttachments,
  input: z.input<typeof reportCollectionInput>,
) {
  const { limit, cursor } = reportCollectionInput.parse(input);
  return withActor(actor, async (tx) => {
    await readReport(tx, id);
    const rows = await tx
      .select()
      .from(table)
      .where(
        and(
          eq(table.reportId, id),
          cursor
            ? sql`
        (${table.createdAt}, ${table.id}) > (
          select ${table.createdAt}, ${table.id} from ${table}
          where ${table.reportId} = ${id} and ${table.id} = ${cursor}
        )
      `
            : undefined,
        ),
      )
      .orderBy(asc(table.createdAt), asc(table.id))
      .limit(limit + 1);
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  });
}

export function listReportComments(
  actor: string,
  id: string,
  input: z.input<typeof reportCollectionInput> = {},
) {
  return reportCollection(actor, id, reportComments, input);
}

export function listReportHistory(
  actor: string,
  id: string,
  input: z.input<typeof reportCollectionInput> = {},
) {
  return reportCollection(actor, id, reportEvents, input);
}

export async function listReportAttachments(
  actor: string,
  id: string,
  input: z.input<typeof reportCollectionInput> = {},
) {
  const { items, nextCursor } = await reportCollection(
    actor,
    id,
    reportAttachments,
    input,
  );
  return {
    items: items.flatMap((item) => {
      if (!("storageKey" in item)) return [];
      const { id, reportId, uploadedBy, name, mediaType, size, createdAt } =
        item;
      return [{ id, reportId, uploadedBy, name, mediaType, size, createdAt }];
    }),
    nextCursor,
  };
}
