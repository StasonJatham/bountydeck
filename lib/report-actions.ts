"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withActor } from "../db";
import {
  programMemberships,
  programScopes,
  reports,
  reportEvents,
  reportComments,
  programs,
  scoreEvents,
} from "../db/schema";
import { requireActor } from "./actor";
import { cvssScore } from "./cvss";
import { canTransition, severities } from "./workflow";

const uuid = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const submission = z.object({
  assetId: uuid,
  title: text(200),
  description: text(12000),
  cwe: z.string().regex(/^CWE-[1-9][0-9]{0,4}$/),
  steps: text(12000),
  proofOfConcept: text(12000),
  impact: text(12000),
  proposedSeverity: z.enum(severities),
});

export async function submitReport(programId: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(programId).success) notFound();
  const parsed = submission.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${programId}?error=invalid-report`);
  const id = await withActor(actor, async (tx) => {
    const [program] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(
        and(eq(programs.id, programId), sql`app_can_submit(${programs.id})`),
      );
    if (!program) notFound();
    const [asset] = await tx
      .select({ id: programScopes.id })
      .from(programScopes)
      .where(
        and(
          eq(programScopes.id, parsed.data.assetId),
          eq(programScopes.programId, programId),
          eq(programScopes.inScope, true),
        ),
      );
    if (!asset) notFound();
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
    if (recent.length >= 10)
      redirect(`/programs/${programId}?error=rate-limit`);
    const [report] = await tx
      .insert(reports)
      .values({ ...parsed.data, programId, reporterId: actor })
      .returning({ id: reports.id });
    await tx.insert(reportEvents).values({
      reportId: report.id,
      actorId: actor,
      kind: "submitted",
      details: {},
    });
    return report.id;
  });
  redirect(`/reports/${id}`);
}

export async function comment(reportId: string, data: FormData) {
  const actor = await requireActor();
  const body = text(5000).safeParse(data.get("body"));
  if (!uuid.safeParse(reportId).success) notFound();
  if (!body.success) redirect(`/reports/${reportId}?error=invalid-comment`);
  const internal = data.get("internal") === "on";
  await withActor(actor, async (tx) => {
    const [report] = await tx
      .select({
        id: reports.id,
        redacted: reports.contentRedactedAt,
        reviewer: sql<boolean>`app_reviews_program(${reports.programId})`,
      })
      .from(reports)
      .where(eq(reports.id, reportId));
    if (!report || report.redacted || (internal && !report.reviewer))
      notFound();
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
    if (recent.length >= 15)
      redirect(`/reports/${reportId}?error=comment-limit`);
    await tx
      .insert(reportComments)
      .values({ reportId, authorId: actor, body: body.data, internal });
    await tx.insert(reportEvents).values({
      reportId,
      actorId: actor,
      kind: "commented",
      internal,
      details: {},
    });
  });
  revalidatePath(`/reports/${reportId}`);
}

export async function transition(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(reportId).success) notFound();
  const vectorInput = data.get("cvssVector");
  const vector = typeof vectorInput === "string" ? vectorInput.trim() : "";
  const score = vector ? cvssScore(vector) : null;
  if (vector && score === null) redirect(`/reports/${reportId}?error=cvss`);
  const target = data.get("status");
  if (typeof target !== "string") notFound();
  await withActor(actor, async (tx) => {
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
    if (!report) notFound();
    if (!canTransition(report.status, target))
      redirect(`/reports/${reportId}?error=transition`);
    const severity = z.enum(severities).safeParse(data.get("severity"));
    if (target === "validated" && !severity.success)
      redirect(`/reports/${reportId}?error=severity`);
    const duplicateOf = uuid.safeParse(data.get("duplicateOf"));
    if (target === "duplicate") {
      if (!duplicateOf.success || duplicateOf.data === reportId)
        redirect(`/reports/${reportId}?error=duplicate`);
      const [duplicate] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.id, duplicateOf.data),
            eq(reports.programId, report.programId),
          ),
        );
      if (!duplicate) redirect(`/reports/${reportId}?error=duplicate`);
    }
    await tx
      .update(reports)
      .set({
        status: target as typeof report.status,
        severity: severity.success ? severity.data : report.severity,
        cvssVector: vector || null,
        cvssScore: score,
        duplicateOfId:
          target === "duplicate" && duplicateOf.success
            ? duplicateOf.data
            : null,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, reportId));
    if (target === "validated" && severity.success) {
      const [program] = await tx
        .select({ scoring: programs.scoring })
        .from(programs)
        .where(eq(programs.id, report.programId));
      const points = z
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(program.scoring[severity.data]);
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
  revalidatePath(`/reports/${reportId}`);
}

export async function correctScore(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(reportId).success) notFound();
  const parsed = z
    .object({
      points: z
        .string()
        .regex(/^-?\d{1,6}$/)
        .transform(Number)
        .refine((value) => value !== 0),
      reason: text(500),
    })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/reports/${reportId}?error=score`);
  await withActor(actor, async (tx) => {
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
    if (!report) notFound();
    const [award] = await tx
      .select({ id: scoreEvents.id })
      .from(scoreEvents)
      .where(
        and(eq(scoreEvents.reportId, reportId), eq(scoreEvents.kind, "award")),
      );
    if (!award) redirect(`/reports/${reportId}?error=score`);
    await tx.insert(scoreEvents).values({
      reportId,
      programId: report.programId,
      userId: report.reporterId,
      actorId: actor,
      kind: "correction",
      ...parsed.data,
    });
    await tx.insert(reportEvents).values({
      reportId,
      actorId: actor,
      kind: "report.score_corrected",
      details: parsed.data,
    });
  });
  revalidatePath(`/reports/${reportId}`);
}

export async function assign(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(reportId).success) notFound();
  const value = data.get("assignee");
  const target = value === "" ? null : uuid.safeParse(value);
  if (target && !target.success)
    redirect(`/reports/${reportId}?error=assignee`);
  await withActor(actor, async (tx) => {
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
    if (!report) notFound();
    const assigneeId = target?.data ?? null;
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
      if (!eligible) redirect(`/reports/${reportId}?error=assignee`);
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
  revalidatePath(`/reports/${reportId}`);
}
