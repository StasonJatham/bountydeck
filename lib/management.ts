"use server";

import { and, eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import {
  auditEvents,
  orgMemberships,
  orgUnits,
  platformSettings,
  programMemberships,
  programs,
  programScopes,
  rewards,
} from "../db/schema";
import { requireActor } from "./actor";

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
  low: z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number),
  medium: z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number),
  high: z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number),
  critical: z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number),
  leaderboardVisibility: z.enum(["members", "hidden"]),
});

export async function createOrganization(data: FormData) {
  const actor = await requireActor();
  const parsed = details.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect("/admin?error=invalid");
  await withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_platform_admin() as ok`,
        )
      ).rows[0].ok
    )
      notFound();
    const [org] = await tx
      .insert(orgUnits)
      .values(parsed.data)
      .onConflictDoNothing()
      .returning({ id: orgUnits.id });
    if (!org) redirect("/admin?error=conflict");
    await tx
      .insert(auditEvents)
      .values({ actorId: actor, orgId: org.id, kind: "organization.created" });
  });
  redirect("/admin");
}

export async function setOrgRole(data: FormData) {
  const actor = await requireActor();
  const parsed = z
    .object({
      orgId: uuid,
      userId: uuid,
      role: z.enum(["admin", "member", "oversight"]),
      change: z.enum(["grant", "revoke"]),
    })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect("/admin?error=invalid");
  const { orgId, userId, role, change } = parsed.data;
  await withActor(actor, async (tx) => {
    const { platform, admin } = (
      await tx.execute<{ platform: boolean; admin: boolean }>(
        sql`select app_platform_admin() as platform, app_org_admin(${orgId}::uuid) as admin`,
      )
    ).rows[0];
    if (!platform && (!admin || role === "oversight")) notFound();
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
  redirect("/admin");
}

export async function createProgram(data: FormData) {
  const actor = await requireActor();
  const parsed = details
    .extend({ orgId: uuid })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect("/admin?error=invalid");
  const id = await withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_org_admin(${parsed.data.orgId}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      notFound();
    const [program] = await tx
      .insert(programs)
      .values(parsed.data)
      .onConflictDoNothing()
      .returning({ id: programs.id });
    if (!program) redirect("/admin?error=conflict");
    await tx.insert(auditEvents).values({
      actorId: actor,
      orgId: parsed.data.orgId,
      kind: "program.created",
      details: { programId: program.id },
    });
    return program.id;
  });
  redirect(`/programs/${id}/manage`);
}

export async function updateProgram(id: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  const parsed = programData.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${id}/manage?error=invalid`);
  await withActor(actor, async (tx) => {
    const { low, medium, high, critical, ...settings } = parsed.data;
    const [program] = await tx
      .update(programs)
      .set({ ...settings, scoring: { low, medium, high, critical } })
      .where(and(eq(programs.id, id), sql`app_manages_program(${id}::uuid)`))
      .returning({ id: programs.id });
    if (!program) notFound();
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "program.updated",
      details: {
        programId: id,
        status: parsed.data.status,
        leaderboardVisibility: parsed.data.leaderboardVisibility,
      },
    });
  });
  redirect(`/programs/${id}/manage`);
}

export async function addScope(id: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  const parsed = z
    .object({ name, description })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${id}/manage?error=invalid`);
  await withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_manages_program(${id}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      notFound();
    await tx.insert(programScopes).values({
      ...parsed.data,
      programId: id,
      inScope: data.get("inScope") === "on",
    });
  });
  redirect(`/programs/${id}/manage`);
}

export async function setProgramRole(id: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  const parsed = z
    .object({
      userId: uuid,
      role: z.enum(["manager", "triager", "researcher"]),
      change: z.enum(["grant", "revoke"]),
    })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${id}/manage?error=invalid`);
  const { userId, role, change } = parsed.data;
  await withActor(actor, async (tx) => {
    const [program] = await tx
      .select({
        orgAdmin: sql<boolean>`app_org_admin(${programs.orgId})`,
        manages: sql<boolean>`app_manages_program(${programs.id})`,
      })
      .from(programs)
      .where(eq(programs.id, id));
    if (!program?.manages || (role === "manager" && !program.orgAdmin))
      notFound();
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
  redirect(`/programs/${id}/manage`);
}

export async function joinProgram(id: string) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  await withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_can_submit(${id}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      notFound();
    await tx
      .insert(programMemberships)
      .values({ programId: id, userId: actor, role: "researcher" })
      .onConflictDoNothing();
  });
  redirect(`/programs/${id}`);
}

export async function addReward(id: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  const parsed = z
    .object({
      name,
      description,
      minimumPoints: z
        .string()
        .regex(/^\d{1,6}$/)
        .transform(Number),
    })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${id}/manage?error=invalid`);
  await withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_manages_program(${id}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      notFound();
    await tx.insert(rewards).values({ ...parsed.data, programId: id });
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "program.reward_added",
      details: { programId: id, name: parsed.data.name },
    });
  });
  redirect(`/programs/${id}/manage`);
}

export async function updateOrganization(data: FormData) {
  const actor = await requireActor();
  const parsed = details
    .extend({ orgId: uuid })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect("/admin?error=invalid");
  const { orgId, ...settings } = parsed.data;
  await withActor(actor, async (tx) => {
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
    if (!organization) notFound();
    await tx
      .insert(auditEvents)
      .values({ actorId: actor, orgId, kind: "organization.updated" });
  });
  redirect("/admin");
}

export async function updateScope(
  programId: string,
  scopeId: string,
  data: FormData,
) {
  const actor = await requireActor();
  if (!uuid.safeParse(programId).success || !uuid.safeParse(scopeId).success)
    notFound();
  const parsed = z
    .object({ name, description })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${programId}/manage?error=invalid`);
  await withActor(actor, async (tx) => {
    const [scope] = await tx
      .update(programScopes)
      .set({ ...parsed.data, inScope: data.get("inScope") === "on" })
      .where(
        and(
          eq(programScopes.id, scopeId),
          eq(programScopes.programId, programId),
          sql`app_manages_program(${programId}::uuid)`,
        ),
      )
      .returning({ id: programScopes.id });
    if (!scope) notFound();
  });
  redirect(`/programs/${programId}/manage`);
}

export async function updatePlatformSettings(data: FormData) {
  const actor = await requireActor();
  const settings = {
    reportExports: data.get("reportExports") === "on",
    globalLeaderboard: data.get("globalLeaderboard") === "on",
  };
  await withActor(actor, async (tx) => {
    const [updated] = await tx
      .update(platformSettings)
      .set(settings)
      .returning({ singleton: platformSettings.singleton });
    if (!updated) notFound();
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "platform.settings_updated",
      details: settings,
    });
  });
  redirect("/admin");
}
