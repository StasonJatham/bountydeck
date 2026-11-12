import { sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../db";
import { IntegrationError } from "./integrations/errors";

export const manualAchievementIds = ["clear-signal", "team-player"] as const;

export const manualAchievementInput = z.object({
  badgeId: z.enum(manualAchievementIds),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((reason) => !reason.includes("\0")),
  revoke: z.boolean(),
});

export async function setManualAchievement(
  actor: string,
  reportId: string,
  input: unknown,
) {
  const target = z.uuid().safeParse(reportId);
  const parsed = manualAchievementInput.safeParse(input);
  if (!target.success || !parsed.success)
    throw new IntegrationError(422, "invalid_input");
  const { badgeId, reason, revoke } = parsed.data;
  try {
    await withActor(actor, (tx) =>
      tx.execute(
        sql`SELECT app_set_manual_achievement(${target.data}, ${badgeId}, ${reason}, ${revoke})`,
      ),
    );
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause && typeof cause === "object" && "code" in cause) {
      if (cause.code === "42501")
        throw new IntegrationError(404, "not_available");
      if (cause.code === "55000") throw new IntegrationError(409, "conflict");
    }
    throw error;
  }
  return { ok: true as const };
}

export async function getManualAchievements(actor: string, reportId: string) {
  return withActor(actor, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM app_manual_achievements_for_report(${reportId})`,
    );
    return rows.map(({ id }) => id);
  });
}
