import { sql } from "drizzle-orm";
import { db } from "../../db";

export async function publicDisclosures(
  kind: "program" | "report",
  after?: string,
) {
  const { rows } = await db.execute<{
    id: string;
    title: string;
    summary: string;
  }>(sql`
    select id, title, summary from public_disclosures
    where kind = ${kind} and id > coalesce(${after ?? null}::uuid, '00000000-0000-0000-0000-000000000000')
    order by id limit 101
  `);
  return {
    items: rows.slice(0, 100),
    nextCursor: rows.length > 100 ? rows[99].id : null,
  };
}
