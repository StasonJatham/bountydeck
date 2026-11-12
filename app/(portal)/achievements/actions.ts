"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  markAchievementsSeen,
  setFeaturedAchievements,
} from "../../../lib/achievements";
import { integrationFailure } from "../../../lib/integrations/errors";
import { requireActor } from "../../../lib/actor";

export async function saveFeatured(data: FormData) {
  const actor = await requireActor();
  const choices = z
    .array(z.string().max(64))
    .max(3)
    .safeParse(data.getAll("featured"));
  if (!choices.success) redirect("/achievements?error=featured#featured");
  try {
    await setFeaturedAchievements(actor, choices.data);
  } catch (error) {
    if (integrationFailure(error).status === 500) throw error;
    redirect("/achievements?error=featured#featured");
  }
  redirect("/achievements?saved=featured#featured");
}

export async function dismissAchievementNotice(ids: string[]) {
  const actor = await requireActor();
  const awards = z.array(z.uuid()).max(30).parse(ids);
  await markAchievementsSeen(actor, awards);
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  revalidatePath("/achievements");
}
