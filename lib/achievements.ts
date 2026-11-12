import { sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../db";

export async function getAchievements(actor: string) {
  return withActor(actor, async (tx) => {
    const { rows: progress } = await tx.execute<{
      badge_id: string;
      progress: string;
    }>(sql`SELECT * FROM app_achievement_progress()`);
    const { rows: awards } = await tx.execute<{
      award_id: string;
      badge_id: string;
      earned_at: string | Date;
      season: string | null;
      featured: boolean;
      seen: boolean;
    }>(sql`SELECT * FROM app_achievement_awards()`);
    return {
      progress: Object.fromEntries(
        progress.map(({ badge_id, progress }) => [badge_id, Number(progress)]),
      ),
      awards: awards.map((award) => ({
        awardId: award.award_id,
        id: award.badge_id,
        earnedAt: new Date(award.earned_at),
        season: award.season,
        featured: award.featured,
        seen: award.seen,
      })),
    };
  });
}

export async function setFeaturedAchievements(actor: string, ids: string[]) {
  const badges = z.array(z.string().max(64)).max(3).parse(ids);
  await withActor(actor, (tx) =>
    tx.execute(
      sql`SELECT app_achievement_feature(ARRAY[${sql.join(
        badges.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])`,
    ),
  );
}

export async function markAchievementsSeen(actor: string, awardIds: string[]) {
  const ids = z.array(z.uuid()).max(100).parse(awardIds);
  await withActor(actor, (tx) =>
    tx.execute(
      sql`SELECT app_achievement_seen(ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[])`,
    ),
  );
}

export async function verifyReproducibility(
  actor: string,
  reportId: string,
  verified: boolean,
) {
  const report = z.uuid().parse(reportId);
  const { rows } = await withActor(actor, (tx) =>
    tx.execute<{ changed: boolean }>(
      sql`SELECT app_achievement_verify_repro(${report}, ${verified}) AS changed`,
    ),
  );
  return rows[0].changed;
}

export async function reconcileAchievements(actor: string) {
  const { rows } = await withActor(actor, (tx) =>
    tx.execute<{ changed: number }>(
      sql`SELECT app_achievement_reconcile() AS changed`,
    ),
  );
  return rows[0].changed;
}

export async function finalizeAchievementSeason(
  actor: string,
  period: "quarter" | "year",
  startsOn: string,
) {
  const date = z.iso.date().parse(startsOn);
  const { rows } = await withActor(actor, (tx) =>
    tx.execute<{ finalized: boolean }>(
      sql`SELECT app_achievement_finalize(${period}, ${date}::date) AS finalized`,
    ),
  );
  return rows[0].finalized;
}
