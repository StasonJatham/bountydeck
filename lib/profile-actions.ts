"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import { profileAvatars, users } from "../db/schema";
import { encodeAvatar } from "./avatar";
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

export async function uploadAvatar(data: FormData) {
  const actor = await requireActor();
  const file = data.get("avatar");
  const image = file instanceof File ? await encodeAvatar(file) : null;
  if (!image) redirect("/profile?error=avatar");
  await withActor(actor, (tx) =>
    tx
      .insert(profileAvatars)
      .values({ userId: actor, image })
      .onConflictDoUpdate({
        target: profileAvatars.userId,
        set: { image, updatedAt: new Date() },
      }),
  );
  redirect("/profile");
}

export async function removeAvatar() {
  const actor = await requireActor();
  await withActor(actor, (tx) =>
    tx.delete(profileAvatars).where(eq(profileAvatars.userId, actor)),
  );
  redirect("/profile");
}
