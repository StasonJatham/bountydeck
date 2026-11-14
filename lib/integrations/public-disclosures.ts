import { sql } from "drizzle-orm";
import { db, withActor } from "../../db";

export async function publicDisclosures(
  kind: "program" | "report",
  after?: string,
) {
  const source =
    kind === "program"
      ? sql`select id, title, summary, null::text as format from public_program_directory()`
      : sql`select id, title, summary, format from public_disclosures where kind = 'report' and audience = 'public'`;
  const { rows } = await db.execute<{
    id: string;
    title: string;
    summary: string;
    format: string | null;
  }>(sql`
    select * from (${source}) as entries
    where id > coalesce(${after ?? null}::uuid, '00000000-0000-0000-0000-000000000000')
    order by id limit 101
  `);
  return {
    items: rows.slice(0, 100),
    nextCursor: rows.length > 100 ? rows[99].id : null,
  };
}

export async function readDisclosure(id: string, actor?: string) {
  const query = sql`select title, summary, format from public_disclosures where id = ${id} and kind = 'report'`;
  const {
    rows: [entry],
  } = actor
    ? await withActor(actor, (tx) =>
        tx.execute<{ title: string; summary: string; format: string }>(query),
      )
    : await db.execute<{ title: string; summary: string; format: string }>(
        query,
      );
  return entry;
}
