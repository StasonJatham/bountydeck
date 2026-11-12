"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import { users } from "../db/schema";
import { requireActor } from "./actor";

export async function updateProfile(data: FormData) {
  const actor = await requireActor();
  const alias = z.string().trim().max(64).safeParse(data.get("pseudonym"));
  if (!alias.success) redirect("/profile?error=invalid");
  const leaderboardVisible = data.get("leaderboardVisible") === "on";
  await withActor(actor, async (tx) => {
    await tx
      .update(users)
      .set({ pseudonym: alias.data || null, leaderboardVisible })
      .where(eq(users.id, actor));
  });
  redirect("/profile");
}
