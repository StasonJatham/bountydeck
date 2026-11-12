import { sql } from "drizzle-orm";
import { withActor } from "./index";

type Season = {
  period: "quarter" | "year";
  starts_at: Date;
  ends_at: Date;
  points: string;
  standing: string | null;
};

type ProgramProgress = {
  program_id: string;
  name: string;
  points: string;
  validated: number;
  earned_rewards: string[];
};

export async function getResearcherProgress(actor: string) {
  return withActor(actor, async (tx) => {
    const {
      rows: [summary],
    } = await tx.execute<{
      points: string;
      validated: number;
      critical: boolean;
    }>(sql`
      SELECT coalesce(sum(points), 0) AS points,
        count(*) FILTER (WHERE kind = 'award')::int AS validated,
        coalesce(bool_or(award_severity = 'critical'), false) AS critical
      FROM score_events WHERE user_id = ${actor}
    `);

    const { rows: programs } = await tx.execute<ProgramProgress>(sql`
      WITH totals AS (
        SELECT program_id, sum(points) AS points, count(*) FILTER (WHERE kind = 'award')::int AS validated
        FROM score_events WHERE user_id = ${actor}
        GROUP BY program_id
      )
      SELECT totals.*, p.name, ARRAY(
        SELECT name FROM rewards WHERE program_id = p.id AND minimum_points <= totals.points ORDER BY minimum_points, name
      ) AS earned_rewards
      FROM totals JOIN programs p ON p.id = totals.program_id
      ORDER BY totals.points DESC, p.id
    `);

    const { rows: seasonRows } = await tx.execute<
      Omit<Season, "starts_at" | "ends_at"> & {
        starts_at: string;
        ends_at: string;
      }
    >(sql`SELECT * FROM app_personal_seasons()`);

    const seasons = seasonRows.map((row) => ({
      ...row,
      starts_at: new Date(row.starts_at),
      ends_at: new Date(row.ends_at),
    }));

    const { rows: milestones } = await tx.execute<{ name: string }>(sql`
      SELECT name FROM achievements
      WHERE minimum_validated <= ${summary.validated}
      ORDER BY minimum_validated, name
    `);
    const achievements = milestones.map(({ name }) => name);
    if (summary.critical) achievements.push("First critical finding");
    if (BigInt(summary.points) >= 1000n)
      achievements.push("One thousand points");
    if (
      seasons.some(
        ({ standing, ends_at }) => standing === "1" && ends_at <= new Date(),
      )
    ) {
      achievements.push("First place in a season");
    }
    return {
      points: summary.points,
      validated: summary.validated,
      programs,
      seasons,
      achievements,
    };
  });
}
