import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db";
import {
  auditEvents,
  orgMemberships,
  orgUnits,
  platformSettings,
  programMemberships,
  programs,
  programScopes,
  rewards,
} from "../../db/schema";
import { IntegrationError } from "./errors";

const uuid = z.uuid();
const name = z.string().trim().min(2).max(100);
const slug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const description = z.string().max(10000);
const details = z.object({ name, slug, description });
const programData = details.extend({
  rules: description,
  disclosurePolicy: description,
  status: z.enum(["draft", "published", "paused", "archived"]),
  eligibility: z.enum(["all", "organization", "invitation"]),
  low: z.number().int().min(0).max(99999),
  medium: z.number().int().min(0).max(99999),
  high: z.number().int().min(0).max(99999),
  critical: z.number().int().min(0).max(99999),
  leaderboardVisibility: z.enum(["members", "hidden"]),
});

export const organizationInput = details;
export const organizationRoleInput = z.object({
  orgId: uuid,
  userId: uuid,
  role: z.enum(["admin", "member", "oversight"]),
  change: z.enum(["grant", "revoke"]),
});
export const programCreateInput = details.extend({ orgId: uuid });
export const programInput = programData;
export const scopeInput = z.object({ name, description });
export const programRoleInput = z.object({
  userId: uuid,
  role: z.enum(["manager", "triager", "researcher"]),
  change: z.enum(["grant", "revoke"]),
});
export const rewardInput = z.object({
  name,
  description,
  minimumPoints: z.number().int().min(0).max(999999),
});
export const organizationUpdateInput = details.extend({ orgId: uuid });
export async function performCreateOrganization(
  actor: string,
  data: z.infer<typeof organizationInput>,
) {
  return withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_platform_admin() as ok`,
        )
      ).rows[0].ok
    )
      throw new IntegrationError(404, "not_found");
    const [org] = await tx
      .insert(orgUnits)
      .values(data)
      .onConflictDoNothing()
      .returning({ id: orgUnits.id });
    if (!org) throw new IntegrationError(409, "conflict");
    await tx
      .insert(auditEvents)
      .values({ actorId: actor, orgId: org.id, kind: "organization.created" });
    return org.id;
  });
}

export async function performSetOrgRole(
  actor: string,
  data: z.infer<typeof organizationRoleInput>,
) {
  const { orgId, userId, role, change } = data;
  return withActor(actor, async (tx) => {
    const { platform, admin } = (
      await tx.execute<{ platform: boolean; admin: boolean }>(
        sql`select app_platform_admin() as platform, app_org_admin(${orgId}::uuid) as admin`,
      )
    ).rows[0];
    if (!platform && (!admin || role === "oversight"))
      throw new IntegrationError(404, "not_found");
    if (change === "grant")
      await tx
        .insert(orgMemberships)
        .values({ orgId, userId, role })
        .onConflictDoNothing();
    else
      await tx
        .delete(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, orgId),
            eq(orgMemberships.userId, userId),
            eq(orgMemberships.role, role),
          ),
        );
    await tx.insert(auditEvents).values({
      actorId: actor,
      orgId,
      kind: `organization.role_${change}`,
      details: { userId, role },
    });
  });
}

export async function performCreateProgram(
  actor: string,
  data: z.infer<typeof programCreateInput>,
) {
  return withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_org_admin(${data.orgId}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      throw new IntegrationError(404, "not_found");
    const [program] = await tx
      .insert(programs)
      .values(data)
      .onConflictDoNothing()
      .returning({ id: programs.id });
    if (!program) throw new IntegrationError(409, "conflict");
    await tx.insert(auditEvents).values({
      actorId: actor,
      orgId: data.orgId,
      kind: "program.created",
      details: { programId: program.id },
    });
    return program.id;
  });
}

export async function performUpdateProgram(
  actor: string,
  id: string,
  data: z.infer<typeof programInput>,
) {
  return withActor(actor, async (tx) => {
    const { low, medium, high, critical, ...settings } = data;
    const [program] = await tx
      .update(programs)
      .set({ ...settings, scoring: { low, medium, high, critical } })
      .where(and(eq(programs.id, id), sql`app_manages_program(${id}::uuid)`))
      .returning({ id: programs.id });
    if (!program) throw new IntegrationError(404, "not_found");
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "program.updated",
      details: {
        programId: id,
        status: data.status,
        leaderboardVisibility: data.leaderboardVisibility,
      },
    });
  });
}

export async function performAddScope(
  actor: string,
  id: string,
  data: z.infer<typeof scopeInput>,
  inScope: boolean,
) {
  return withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_manages_program(${id}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      throw new IntegrationError(404, "not_found");
    await tx.insert(programScopes).values({
      ...data,
      programId: id,
      inScope: inScope,
    });
  });
}

export async function performSetProgramRole(
  actor: string,
  id: string,
  data: z.infer<typeof programRoleInput>,
) {
  const { userId, role, change } = data;
  return withActor(actor, async (tx) => {
    const [program] = await tx
      .select({
        orgAdmin: sql<boolean>`app_org_admin(${programs.orgId})`,
        manages: sql<boolean>`app_manages_program(${programs.id})`,
      })
      .from(programs)
      .where(eq(programs.id, id));
    if (!program?.manages || (role === "manager" && !program.orgAdmin))
      throw new IntegrationError(404, "not_found");
    if (change === "grant")
      await tx
        .insert(programMemberships)
        .values({ programId: id, userId, role })
        .onConflictDoNothing();
    else
      await tx
        .delete(programMemberships)
        .where(
          and(
            eq(programMemberships.programId, id),
            eq(programMemberships.userId, userId),
            eq(programMemberships.role, role),
          ),
        );
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: `program.role_${change}`,
      details: { programId: id, userId, role },
    });
  });
}

export async function performJoinProgram(actor: string, id: string) {
  return withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_can_submit(${id}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      throw new IntegrationError(404, "not_found");
    await tx
      .insert(programMemberships)
      .values({ programId: id, userId: actor, role: "researcher" })
      .onConflictDoNothing();
  });
}

export async function performAddReward(
  actor: string,
  id: string,
  data: z.infer<typeof rewardInput>,
) {
  return withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_manages_program(${id}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      throw new IntegrationError(404, "not_found");
    await tx.insert(rewards).values({ ...data, programId: id });
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "program.reward_added",
      details: { programId: id, name: data.name },
    });
  });
}

export async function performUpdateOrganization(
  actor: string,
  data: z.infer<typeof organizationUpdateInput>,
) {
  const { orgId, ...settings } = data;
  return withActor(actor, async (tx) => {
    const [organization] = await tx
      .update(orgUnits)
      .set(settings)
      .where(
        and(
          eq(orgUnits.id, orgId),
          sql`app_org_admin(${orgId}::uuid) or app_platform_admin()`,
        ),
      )
      .returning({ id: orgUnits.id });
    if (!organization) throw new IntegrationError(404, "not_found");
    await tx
      .insert(auditEvents)
      .values({ actorId: actor, orgId, kind: "organization.updated" });
  });
}

export async function performUpdateScope(
  actor: string,
  programId: string,
  scopeId: string,
  data: z.infer<typeof scopeInput>,
  inScope: boolean,
) {
  return withActor(actor, async (tx) => {
    const [scope] = await tx
      .update(programScopes)
      .set({ ...data, inScope: inScope })
      .where(
        and(
          eq(programScopes.id, scopeId),
          eq(programScopes.programId, programId),
          sql`app_manages_program(${programId}::uuid)`,
        ),
      )
      .returning({ id: programScopes.id });
    if (!scope) throw new IntegrationError(404, "not_found");
  });
}

export async function performUpdatePlatformSettings(
  actor: string,
  settings: { reportExports: boolean; globalLeaderboard: boolean },
) {
  return withActor(actor, async (tx) => {
    const [updated] = await tx
      .update(platformSettings)
      .set(settings)
      .returning({ singleton: platformSettings.singleton });
    if (!updated) throw new IntegrationError(404, "not_found");
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "platform.settings_updated",
      details: settings,
    });
  });
}
