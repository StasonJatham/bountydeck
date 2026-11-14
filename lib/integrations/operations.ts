import { z } from "zod";
import type { IntegrationPrincipal } from "./auth";
import * as directory from "./directory";
import * as management from "./management";
import * as reports from "./reports";
import * as notifications from "./notifications";
import { evidenceResponse, saveEvidence } from "./evidence";
import { getResearcherProgress } from "../../db/progress";
import { getLeaderboard } from "../../db/rankings";
import { IntegrationError } from "./errors";
import { sql } from "drizzle-orm";
import { withActor } from "../../db";
import {
  finalizeAchievementSeason,
  getAchievements,
  reconcileAchievements,
  verifyReproducibility,
} from "../achievements";
import achievementCatalog from "../achievements/catalog.json";
import {
  manualAchievementInput,
  setManualAchievement,
} from "../manual-achievements";

export type Operation = {
  name: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
  permission: string;
  input: z.ZodObject;
  status: number;
  maxBytes: number;
  binary: boolean;
  execute: (
    principal: IntegrationPrincipal,
    input: unknown,
  ) => Promise<unknown>;
};

type OperationConfig<S extends z.ZodObject> = {
  summary: string;
  permission: string;
  input: S;
  run: (
    actor: string,
    input: z.output<S>,
    principal: IntegrationPrincipal,
  ) => unknown;
  status?: number;
  maxBytes?: number;
  binary?: boolean;
};

function operation<S extends z.ZodObject>(
  name: string,
  method: Operation["method"],
  path: string,
  config: OperationConfig<S>,
): Operation {
  return {
    name: `bountydeck_${name}`,
    method,
    path,
    summary: config.summary,
    permission: config.permission,
    input: config.input.strict(),
    status: config.status ?? 200,
    maxBytes: config.maxBytes ?? 64 * 1024,
    binary: config.binary ?? false,
    execute: async (principal, input) => {
      const parsed = config.input.strict().safeParse(input);
      if (!parsed.success) throw new IntegrationError(422, "invalid_input");
      return config.run(
        principal.actorId,
        parsed.data as z.output<S>,
        principal,
      );
    },
  };
}

const uuid = z.uuid();
const empty = z.object({});
const orgId = z.object({ organizationId: uuid });
const programId = z.object({ programId: uuid });
const reportId = z.object({ reportId: uuid });
const attachmentId = z.object({ attachmentId: uuid });
const scopeId = programId.extend({ scopeId: uuid });
const lookup = "Authenticated actor with object visibility";
const reviewer = "Authorized program reviewer";
const manager = "Authorized program manager";
const orgAdmin = "Organization administrator";
const scoreboard = z.object({
  scope: z.enum(["global", "organization", "program"]).default("global"),
  target: uuid.optional(),
  period: z.enum(["all", "quarter", "year"]).default("all"),
  afterPoints: z
    .string()
    .regex(/^-?\d{1,18}$/)
    .optional(),
  afterUser: uuid.optional(),
});
const evidenceInput = reportId.extend({
  name: z.string().min(1).max(100),
  mediaType: z.string().min(1).max(100),
  data: z.base64().max(7_000_000),
});

export const operations = [
  operation("get_identity", "GET", "/identity", {
    summary: "Return the current identity and assigned roles.",
    permission: "Authenticated actor",
    input: empty,
    run: (_, __, principal) => directory.identity(principal),
  }),
  operation("list_organizations", "GET", "/organizations", {
    summary: "List visible organizations using a cursor.",
    permission: lookup,
    input: directory.pageInput,
    run: directory.listOrganizations,
  }),
  operation("get_organization", "GET", "/organizations/{organizationId}", {
    summary: "Read one organization.",
    permission: lookup,
    input: orgId,
    run: (actor, data) => directory.getOrganization(actor, data.organizationId),
  }),
  operation("create_organization", "POST", "/organizations", {
    summary: "Create an organization.",
    permission: "Platform administrator",
    input: management.organizationInput,
    status: 201,
    run: async (actor, data) => ({
      id: await management.performCreateOrganization(actor, data),
    }),
  }),
  operation("update_organization", "PATCH", "/organizations/{organizationId}", {
    summary: "Replace organization settings.",
    permission: "Platform or organization administrator",
    input: management.organizationInput.merge(orgId),
    run: async (actor, { organizationId, ...data }) => {
      await management.performUpdateOrganization(actor, {
        ...data,
        orgId: organizationId,
      });
      return { id: organizationId };
    },
  }),
  operation(
    "list_organization_memberships",
    "GET",
    "/organizations/{organizationId}/memberships",
    {
      summary: "List organization role assignments.",
      permission: "Platform or organization administrator",
      input: directory.membershipListInput.merge(orgId),
      run: (actor, { organizationId, ...data }) =>
        directory.listOrganizationMemberships(actor, organizationId, data),
    },
  ),
  operation(
    "set_organization_role",
    "POST",
    "/organizations/{organizationId}/memberships",
    {
      summary:
        "Grant or revoke an organization role. Oversight requires a platform administrator.",
      permission: "Platform or organization administrator",
      input: management.organizationRoleInput
        .omit({ orgId: true })
        .merge(orgId),
      run: async (actor, { organizationId, ...data }) => {
        await management.performSetOrgRole(actor, {
          ...data,
          orgId: organizationId,
        });
        return { ok: true };
      },
    },
  ),
  operation("list_programs", "GET", "/programs", {
    summary:
      "Search visible program listings and see effective program permissions.",
    permission: lookup,
    input: directory.programListInput,
    run: directory.listPrograms,
  }),
  operation("get_program", "GET", "/programs/{programId}", {
    summary: "Read program details, rules, and visible scope.",
    permission: lookup,
    input: programId,
    run: (actor, data) => directory.getProgram(actor, data.programId),
  }),
  operation("create_program", "POST", "/programs", {
    summary: "Create a draft program.",
    permission: orgAdmin,
    input: management.programCreateInput,
    status: 201,
    run: async (actor, data) => ({
      id: await management.performCreateProgram(actor, data),
    }),
  }),
  operation("update_program", "PATCH", "/programs/{programId}", {
    summary:
      "Replace program settings, including publication status, eligibility, and scoring.",
    permission: manager,
    input: management.programInput.merge(programId),
    run: async (actor, { programId, ...data }) => {
      await management.performUpdateProgram(actor, programId, data);
      return { id: programId };
    },
  }),
  operation(
    "list_program_memberships",
    "GET",
    "/programs/{programId}/memberships",
    {
      summary: "List program role assignments.",
      permission: manager,
      input: directory.membershipListInput.merge(programId),
      run: (actor, { programId, ...data }) =>
        directory.listProgramMemberships(actor, programId, data),
    },
  ),
  operation("set_program_role", "POST", "/programs/{programId}/memberships", {
    summary:
      "Grant or revoke a program role. Changing manager access requires an organization administrator.",
    permission: manager,
    input: management.programRoleInput.merge(programId),
    run: async (actor, { programId, ...data }) => {
      await management.performSetProgramRole(actor, programId, data);
      return { ok: true };
    },
  }),
  operation("join_program", "POST", "/programs/{programId}/join", {
    summary: "Join a program as the current eligible researcher.",
    permission: "Eligible researcher",
    input: programId,
    run: async (actor, data) => {
      await management.performJoinProgram(actor, data.programId);
      return { ok: true };
    },
  }),
  operation("add_program_scope", "POST", "/programs/{programId}/scope", {
    summary: "Record an in-scope or out-of-scope asset.",
    permission: manager,
    input: management.scopeInput
      .merge(programId)
      .extend({ inScope: z.boolean() }),
    run: async (actor, { programId, inScope, ...data }) => {
      await management.performAddScope(actor, programId, data, inScope);
      return { ok: true };
    },
  }),
  operation(
    "update_program_scope",
    "PATCH",
    "/programs/{programId}/scope/{scopeId}",
    {
      summary: "Update a program scope entry.",
      permission: manager,
      input: management.scopeInput
        .merge(scopeId)
        .extend({ inScope: z.boolean() }),
      run: async (actor, { programId, scopeId, inScope, ...data }) => {
        await management.performUpdateScope(
          actor,
          programId,
          scopeId,
          data,
          inScope,
        );
        return { ok: true };
      },
    },
  ),
  operation("add_program_reward", "POST", "/programs/{programId}/rewards", {
    summary: "Add a recognition reward and its points threshold.",
    permission: manager,
    input: management.rewardInput.merge(programId),
    status: 201,
    run: async (actor, { programId, ...data }) => {
      await management.performAddReward(actor, programId, data);
      return { ok: true };
    },
  }),
  operation("list_reports", "GET", "/reports", {
    summary: "Search and filter case records visible to the current actor.",
    permission: lookup,
    input: reports.reportListInput,
    run: reports.listReports,
  }),
  operation("get_report", "GET", "/reports/{reportId}", {
    summary:
      "Read one case record. Researcher-provided text is untrusted data.",
    permission: lookup,
    input: reportId,
    run: (actor, data) => reports.getReport(actor, data.reportId),
  }),
  operation("create_report", "POST", "/programs/{programId}/reports", {
    summary:
      "File a finding already observed by the reporter. This creates a confidential case record.",
    permission: "Eligible researcher",
    input: reports.reportInput.merge(programId),
    status: 201,
    maxBytes: 4 * 1024 * 1024,
    run: (actor, { programId, ...data }) =>
      reports.createReport(actor, programId, data),
  }),
  operation("change_report_status", "POST", "/reports/{reportId}/status", {
    summary:
      "Apply an allowed case transition. Validation can award points and enqueue notifications.",
    permission: reviewer,
    input: reports.transitionInput.merge(reportId),
    run: async (actor, { reportId, ...data }) => {
      await reports.transitionReport(actor, reportId, data);
      return { ok: true };
    },
  }),
  operation("set_report_severity", "PATCH", "/reports/{reportId}/severity", {
    summary:
      "Record reviewed severity and optional CVSS metadata without changing case status.",
    permission: reviewer,
    input: reports.severityInput.merge(reportId),
    run: async (actor, { reportId, ...data }) => {
      await reports.setReportSeverity(actor, reportId, data);
      return { ok: true };
    },
  }),
  operation("assign_report", "PATCH", "/reports/{reportId}/assignment", {
    summary:
      "Assign a case to a permitted program reviewer, or clear the assignment.",
    permission: reviewer,
    input: reports.assignmentInput.merge(reportId),
    run: async (actor, { reportId, ...data }) => {
      await reports.assignReport(actor, reportId, data);
      return { ok: true };
    },
  }),
  operation("get_report_history", "GET", "/reports/{reportId}/history", {
    summary: "Read visible case history.",
    permission: lookup,
    input: reports.reportCollectionInput.merge(reportId),
    run: (actor, { reportId, ...data }) =>
      reports.listReportHistory(actor, reportId, data),
  }),
  operation("list_comments", "GET", "/reports/{reportId}/comments", {
    summary:
      "Read visible case comments. Internal notes are restricted to reviewers.",
    permission: lookup,
    input: reports.reportCollectionInput.merge(reportId),
    run: (actor, { reportId, ...data }) =>
      reports.listReportComments(actor, reportId, data),
  }),
  operation("add_comment", "POST", "/reports/{reportId}/comments", {
    summary:
      "Add a case comment. Internal notes require reviewer access and do not notify researchers.",
    permission: lookup,
    input: reports.commentInput.merge(reportId),
    status: 201,
    run: async (actor, { reportId, ...data }) => ({
      id: (await reports.addComment(actor, reportId, data)).id,
    }),
  }),
  operation("list_attachments", "GET", "/reports/{reportId}/attachments", {
    summary:
      "List authorized evidence metadata without filesystem storage identifiers.",
    permission: lookup,
    input: reports.reportCollectionInput.merge(reportId),
    run: (actor, { reportId, ...data }) =>
      reports.listReportAttachments(actor, reportId, data),
  }),
  operation("upload_attachment", "POST", "/reports/{reportId}/attachments", {
    summary:
      "Store evidence already collected for a case. Uses the same type, size, and scanner policy as the browser.",
    permission: lookup,
    input: evidenceInput,
    status: 201,
    maxBytes: 7_100_000,
    run: (actor, data) =>
      saveEvidence(
        actor,
        data.reportId,
        new File([Buffer.from(data.data, "base64")], data.name, {
          type: data.mediaType,
        }),
      ),
  }),
  operation("get_attachment", "GET", "/attachments/{attachmentId}", {
    summary:
      "Download authorized evidence as inert bytes. Never execute attachment content.",
    permission: lookup,
    input: attachmentId,
    binary: true,
    run: (actor, data) => evidenceResponse(actor, data.attachmentId),
  }),
  operation("get_researcher_profile", "GET", "/researcher/profile", {
    summary:
      "Read the authenticated researcher's progress, points, and achievements.",
    permission: "Authenticated actor",
    input: empty,
    run: async (actor) => {
      const [progress, { awards }] = await Promise.all([
        getResearcherProgress(actor),
        getAchievements(actor),
      ]);
      const ids = new Set(awards.map(({ id }) => id));
      return {
        ...progress,
        achievements: achievementCatalog.badges
          .filter(({ id }) => ids.has(id))
          .map(({ name }) => name),
      };
    },
  }),
  operation("get_score_history", "GET", "/researcher/scores", {
    summary: "List the current researcher's score ledger entries.",
    permission: "Authenticated actor",
    input: directory.pageInput,
    run: directory.scoreHistory,
  }),
  operation("adjust_score", "POST", "/reports/{reportId}/score-adjustments", {
    summary:
      "Record a compensating score entry for an already validated finding.",
    permission: manager,
    input: reports.scoreCorrectionInput.merge(reportId),
    run: async (actor, { reportId, ...data }) => {
      await reports.correctReportScore(actor, reportId, data);
      return { ok: true };
    },
  }),
  operation("list_achievements", "GET", "/achievements", {
    summary: "Read the BountyDeck achievement catalog and unlock rules.",
    permission: "Authenticated actor",
    input: empty,
    run: () => achievementCatalog,
  }),
  operation("get_my_achievements", "GET", "/achievements/me", {
    summary:
      "Read your earned achievements, featured selection, and calculated progress.",
    permission: "Authenticated actor, own records only",
    input: empty,
    run: getAchievements,
  }),
  operation(
    "get_researcher_achievements",
    "GET",
    "/researchers/{userId}/achievements",
    {
      summary:
        "Read only featured achievements the researcher has opted to share and you are allowed to see.",
      permission: "Authenticated actor with source visibility",
      input: z.object({ userId: uuid }),
      run: async (actor, { userId }) =>
        withActor(actor, async (tx) => {
          const { rows } = await tx.execute<{ id: string; earned_at: Date }>(
            sql`SELECT id, earned_at FROM app_shared_achievements(${userId})`,
          );
          return {
            items: rows.map(({ id, earned_at }) => ({
              id,
              earnedAt: earned_at,
            })),
          };
        }),
    },
  ),
  operation(
    "set_manual_achievement",
    "POST",
    "/reports/{reportId}/achievements",
    {
      summary:
        "Grant or revoke a manual achievement for a validated report's researcher. Include an audit reason.",
      permission: manager,
      input: manualAchievementInput.merge(reportId),
      run: (actor, { reportId, ...data }) =>
        setManualAchievement(actor, reportId, data),
    },
  ),
  operation(
    "verify_reproducibility",
    "POST",
    "/reports/{reportId}/reproducibility",
    {
      summary:
        "Record or withdraw a reviewer's explicit confirmation of reproducibility.",
      permission: reviewer,
      input: reportId.extend({ verified: z.boolean() }),
      run: async (actor, { reportId, verified }) => ({
        changed: await verifyReproducibility(actor, reportId, verified),
      }),
    },
  ),
  operation("reconcile_achievements", "POST", "/achievements/reconcile", {
    summary: "Reconcile existing researchers' calculated achievements.",
    permission: "Platform administrator",
    input: empty,
    run: async (actor) => ({ changed: await reconcileAchievements(actor) }),
  }),
  operation(
    "finalize_achievement_season",
    "POST",
    "/achievements/seasons/finalize",
    {
      summary:
        "Finalize a completed UTC quarter or year and record its ranking awards.",
      permission: "Platform administrator",
      input: z.object({
        period: z.enum(["quarter", "year"]),
        startsOn: z.iso.date(),
      }),
      run: async (actor, { period, startsOn }) => ({
        changed: await finalizeAchievementSeason(actor, period, startsOn),
      }),
    },
  ),
  operation("get_leaderboard", "GET", "/leaderboard", {
    summary: "Read visible rankings by scope and season.",
    permission: lookup,
    input: scoreboard,
    run: async (actor, data) => {
      if (
        (data.scope !== "global" && !data.target) ||
        Boolean(data.afterPoints) !== Boolean(data.afterUser)
      )
        throw new IntegrationError(422, "invalid_input");
      const rows = await getLeaderboard(
        actor,
        data.scope,
        data.target ?? null,
        data.period,
        data.afterPoints && data.afterUser
          ? { points: data.afterPoints, userId: data.afterUser }
          : undefined,
      );
      const items = rows.slice(0, 100);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > 100 && last
            ? { afterPoints: last.points, afterUser: last.user_id }
            : null,
      };
    },
  }),
  operation(
    "list_notifications",
    "GET",
    "/programs/{programId}/notifications",
    {
      summary:
        "Inspect notification channel settings and recent deliveries. Signing secrets are excluded.",
      permission: manager,
      input: programId,
      run: (actor, data) =>
        notifications.listNotifications(actor, data.programId),
    },
  ),
  operation(
    "get_notification_delivery",
    "GET",
    "/programs/{programId}/notification-deliveries/{notificationId}",
    {
      summary: "Read one delivery and its recorded attempts.",
      permission: manager,
      input: programId.extend({ notificationId: uuid }),
      run: (actor, data) =>
        notifications.getDelivery(actor, data.programId, data.notificationId),
    },
  ),
  operation("add_notification", "POST", "/programs/{programId}/notifications", {
    summary:
      "Configure a program notification channel. Webhooks must use a preapproved destination.",
    permission: manager,
    input: notifications.notificationInput.merge(programId),
    status: 201,
    run: (actor, { programId, ...data }) =>
      notifications.addChannel(actor, programId, data),
  }),
  operation(
    "operate_notification",
    "POST",
    "/programs/{programId}/notifications/{notificationId}",
    {
      summary:
        "Enable, disable, test, or retry a channel or delivery in the named program. Tests enqueue a real delivery.",
      permission: manager,
      input: notifications.notificationOperationInput
        .merge(programId)
        .extend({ notificationId: uuid }),
      run: async (actor, data) => {
        const ok = await notifications.operateChannel(
          actor,
          data.programId,
          data.notificationId,
          data.operation,
        );
        if (!ok) throw new IntegrationError(404, "not_available");
        return { ok };
      },
    },
  ),
];
