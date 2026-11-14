"use server";

import { eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import { auditEvents, sessions, users } from "../db/schema";
import { requireActor } from "./actor";

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
