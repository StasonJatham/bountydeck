"use server";

import { and, eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import { accounts, auditEvents, sessions, users } from "../db/schema";
import { requireActor } from "./actor";
import { keycloakAdmin, keycloakAdminEnabled } from "./keycloak-admin";

export async function listAdminUsers() {
  const actor = await requireActor();
  return withActor(actor, async (tx) => {
    const { admin } = (
      await tx.execute<{ admin: boolean }>(
        sql`select app_platform_admin() as admin`,
      )
    ).rows[0];
    if (!admin) notFound();
    return tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.platformRole,
      })
      .from(users)
      .orderBy(users.email)
      .limit(100);
  });
}

export async function revokeUserSessions(data: FormData) {
  const actor = await requireActor();
  const target = z.uuid().safeParse(data.get("userId"));
  if (!target.success || target.data === actor) notFound();
  await withActor(actor, async (tx) => {
    const { admin } = (
      await tx.execute<{ admin: boolean }>(
        sql`select app_platform_admin() as admin`,
      )
    ).rows[0];
    if (!admin) notFound();
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, target.data));
    if (!user) notFound();
    const revoked = await tx
      .delete(sessions)
      .where(eq(sessions.userId, user.id));
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "user.sessions_revoked",
      details: { userId: user.id, count: revoked.rowCount },
    });
  });
  redirect("/admin/users?revoked=1");
}

export async function listManagedIdentities(first: number) {
  const actor = await requirePlatformAdmin();
  if (!keycloakAdminEnabled())
    return { state: "unconfigured" as const, identities: [] };
  try {
    const realm = await keycloakAdmin();
    const identities = await realm.list(first);
    const protectedSubjects = await withActor(actor, (tx) =>
      tx
        .select({ subject: accounts.providerAccountId })
        .from(accounts)
        .innerJoin(users, eq(users.id, accounts.userId))
        .where(
          and(
            eq(accounts.provider, `oidc:${process.env.OIDC_ISSUER}`),
            eq(users.platformRole, "admin"),
          ),
        ),
    );
    const protectedIds = new Set(
      protectedSubjects.map((account) => account.subject),
    );
    return {
      state: "ready" as const,
      identities: identities.filter(({ id }) => !protectedIds.has(id)),
    };
  } catch {
    return { state: "unavailable" as const, identities: [] };
  }
}

async function requirePlatformAdmin() {
  const actor = await requireActor();
  const {
    rows: [{ admin }],
  } = await withActor(actor, (tx) =>
    tx.execute<{ admin: boolean }>(sql`select app_platform_admin() as admin`),
  );
  if (!admin) notFound();
  return actor;
}

const profile = z.object({
  firstName: z.string().trim().max(120),
  lastName: z.string().trim().max(120),
  email: z.email().max(254),
});
const password = z.string().min(12).max(256);
const operation = z.enum([
  "edit",
  "disable",
  "enable",
  "reset",
  "requirePassword",
  "logout",
  "delete",
]);

export async function createManagedIdentity(data: FormData) {
  const actor = await requirePlatformAdmin();
  const parsed = profile
    .extend({
      username: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/),
      password,
    })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect("/admin/users?identity=invalid");
  try {
    const realm = await keycloakAdmin();
    await realm.create(parsed.data);
    await withActor(actor, (tx) =>
      tx
        .insert(auditEvents)
        .values({ actorId: actor, kind: "user.identity_created", details: {} }),
    );
  } catch {
    redirect("/admin/users?identity=failed");
  }
  redirect("/admin/users?identity=saved");
}

export async function manageIdentity(data: FormData) {
  const actor = await requirePlatformAdmin();
  const parsed = z
    .object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/), operation })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect("/admin/users?identity=invalid");
  const { id, operation: action } = parsed.data;
  const [local] = await withActor(actor, (tx) =>
    tx
      .select({ id: users.id, role: users.platformRole })
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(
        and(
          eq(accounts.provider, `oidc:${process.env.OIDC_ISSUER}`),
          eq(accounts.providerAccountId, id),
        ),
      ),
  );
  if (local?.id === actor || local?.role === "admin") notFound();
  const changes = profile.safeParse(Object.fromEntries(data));
  const reset = password.safeParse(data.get("password"));
  if (
    (action === "edit" && !changes.success) ||
    (action === "reset" && !reset.success) ||
    (action === "delete" && data.get("confirm") !== "yes")
  )
    redirect("/admin/users?identity=invalid");

  try {
    const realm = await keycloakAdmin();
    const target = await realm.target(id);
    if (local && (action === "disable" || action === "delete")) {
      await withActor(actor, async (tx) => {
        await tx
          .update(users)
          .set({ loginDisabled: true })
          .where(eq(users.id, local.id));
        await tx.delete(sessions).where(eq(sessions.userId, local.id));
      });
    }

    if (action === "edit" && changes.success) {
      const current = await target.get();
      await target.update({
        ...changes.data,
        ...(current.email !== changes.data.email
          ? { emailVerified: false }
          : {}),
      });
    }
    if (action === "enable" || action === "disable")
      await target.update({ enabled: action === "enable" });
    if (action === "reset" && reset.success) await target.reset(reset.data);
    if (action === "requirePassword") {
      const user = await target.get();
      await target.update({
        requiredActions: [
          ...new Set([...(user.requiredActions ?? []), "UPDATE_PASSWORD"]),
        ],
      });
    }
    if (action === "delete") await target.remove();
    if (["disable", "reset", "requirePassword", "logout"].includes(action))
      await target.logout();

    await withActor(actor, async (tx) => {
      if (local) {
        if (action === "enable")
          await tx
            .update(users)
            .set({ loginDisabled: false })
            .where(eq(users.id, local.id));
        if (["reset", "requirePassword", "logout"].includes(action))
          await tx.delete(sessions).where(eq(sessions.userId, local.id));
      }
      await tx.insert(auditEvents).values({
        actorId: actor,
        kind: `user.identity_${action}`,
        details: { subject: id, ...(local ? { userId: local.id } : {}) },
      });
    });
  } catch {
    redirect("/admin/users?identity=failed");
  }
  redirect("/admin/users?identity=saved");
}
