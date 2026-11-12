"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  finalizeAchievementSeason,
  reconcileAchievements,
  verifyReproducibility,
} from "../../../lib/achievements";
import { requireActor } from "../../../lib/actor";
import { integrationFailure } from "../../../lib/integrations/errors";
import {
  manualAchievementIds,
  setManualAchievement,
} from "../../../lib/manual-achievements";

function reviewError(error: unknown, returnTo: string): never {
  const failure = integrationFailure(error);
  if (failure.status === 404 || failure.status === 403) notFound();
  if (failure.status === 500) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (!(
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "22023"
    )) {
      throw error;
    }
  }
  redirect(`${returnTo}?achievement=error`);
}

export async function saveReproducibility(reportId: string, data: FormData) {
  const actor = await requireActor();
  const verified = z.enum(["true", "false"]).safeParse(data.get("verified"));
  if (!z.uuid().safeParse(reportId).success) notFound();
  const returnTo = `/reports/${reportId}`;
  if (!verified.success) redirect(`${returnTo}?achievement=error`);
  try {
    await verifyReproducibility(actor, reportId, verified.data === "true");
  } catch (error) {
    reviewError(error, returnTo);
  }
  redirect(`${returnTo}?achievement=saved`);
}

export async function saveRecognition(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(reportId).success) notFound();
  const returnTo = `/reports/${reportId}`;
  const recognition = z
    .object({
      badgeId: z.enum(manualAchievementIds),
      reason: z.string().trim().min(1).max(500),
      operation: z.enum(["grant", "revoke"]),
    })
    .safeParse(Object.fromEntries(data));
  if (!recognition.success) redirect(`${returnTo}?achievement=error`);
  const { badgeId, reason, operation } = recognition.data;
  try {
    await setManualAchievement(actor, reportId, {
      badgeId,
      reason,
      revoke: operation === "revoke",
    });
  } catch (error) {
    reviewError(error, returnTo);
  }
  redirect(`${returnTo}?achievement=saved`);
}

export async function reconcileAwardHistory() {
  const actor = await requireActor();
  try {
    await reconcileAchievements(actor);
  } catch (error) {
    reviewError(error, "/admin");
  }
  redirect("/admin?achievement=saved");
}

export async function finalizeAwardSeason(data: FormData) {
  const actor = await requireActor();
  const season = z
    .object({
      period: z.enum(["quarter", "year"]),
      startsOn: z.iso.date(),
    })
    .safeParse(Object.fromEntries(data));
  if (!season.success) redirect("/admin?achievement=error");
  try {
    await finalizeAchievementSeason(
      actor,
      season.data.period,
      season.data.startsOn,
    );
  } catch (error) {
    reviewError(error, "/admin");
  }
  redirect("/admin?achievement=saved");
}
