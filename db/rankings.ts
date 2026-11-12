import { sql } from "drizzle-orm";
import { withActor } from "./index";

type Ranking = {
  user_id: string;
  label: string;
  points: string;
  standing: string;
  is_self: boolean;
};

export async function getLeaderboard(
  actor: string,
  scope: "global" | "organization" | "program",
  target: string | null,
  period: "all" | "quarter" | "year",
  after?: { points: string; userId: string },
) {
  const { rows } = await withActor(actor, (tx) =>
    tx.execute<Ranking>(sql`
      select * from app_leaderboard(
        ${scope}, ${target}::uuid, ${period},
        ${after?.points ?? null}::bigint, ${after?.userId ?? null}::uuid
      )
    `),
  );
  return rows;
}
