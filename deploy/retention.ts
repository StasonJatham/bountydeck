import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const [org, daysText, actor, mode, ...extra] = process.argv.slice(2);
  const days = Number(daysText);
  if (
    !uuid.test(org) ||
    !uuid.test(actor) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 36500 ||
    (mode !== undefined && mode !== "--apply") ||
    extra.length ||
    !process.env.RETENTION_DATABASE_URL ||
    !process.env.ATTACHMENTS_DIR
  ) {
    throw new Error(
      "Usage: retention <organization UUID> <age in days> <platform admin UUID> [--apply]",
    );
  }
  const directory = process.env.ATTACHMENTS_DIR;
  const client = new Client({
    connectionString: process.env.RETENTION_DATABASE_URL,
  });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(1634497635)");
    await client.query("BEGIN");
    const { rowCount: authorized } = await client.query(
      "SELECT FROM users WHERE id = $1 AND platform_role = 'admin' AND EXISTS (SELECT FROM org_units WHERE id = $2)",
      [actor, org],
    );
    if (!authorized)
      throw new Error("Unknown organization or platform administrator");
    await client.query(
      "CREATE TEMP TABLE retention_target (id uuid PRIMARY KEY) ON COMMIT DROP",
    );
    await client.query(
      `INSERT INTO retention_target (id)
       SELECT r.id FROM reports r JOIN programs p ON p.id = r.program_id
       WHERE p.org_id = $1 AND r.content_redacted_at IS NULL
         AND r.status IN ('resolved', 'duplicate', 'informative', 'out_of_scope', 'not_applicable')
         AND r.updated_at < now() - make_interval(days => $2)
       FOR UPDATE OF r`,
      [org, days],
    );
    const {
      rows: [{ count }],
    } = await client.query<{ count: string }>(
      "SELECT count(*) FROM retention_target",
    );
    if (mode !== "--apply") {
      await client.query("ROLLBACK");
      console.log(
        `${count} closed reports qualify for content redaction. Pass --apply to execute.`,
      );
      return;
    }
    await client.query(`
      WITH removed AS (
        DELETE FROM report_attachments WHERE report_id IN (SELECT id FROM retention_target)
        RETURNING storage_key
      ) INSERT INTO evidence_gc SELECT storage_key FROM removed;
      DELETE FROM report_comments WHERE report_id IN (SELECT id FROM retention_target);
      UPDATE reports SET title = 'Report content expired', description = '', steps = '',
        proof_of_concept = '', impact = '', cvss_vector = NULL, cvss_score = NULL,
        content_redacted_at = now()
      WHERE id IN (SELECT id FROM retention_target);
    `);
    await client.query(
      "INSERT INTO report_events (report_id, actor_id, kind) SELECT id, $1, 'report.content_redacted' FROM retention_target",
      [actor],
    );
    await client.query(
      "INSERT INTO audit_events (org_id, actor_id, kind, details) VALUES ($1, $2, 'retention.applied', jsonb_build_object('reportCount', $3::bigint, 'ageDays', $4::int))",
      [org, actor, count, days],
    );
    await client.query("COMMIT");
    const { rows } = await client.query<{ storage_key: string }>(
      "SELECT storage_key FROM evidence_gc",
    );
    let failures = 0;
    for (const { storage_key } of rows) {
      if (!uuid.test(storage_key)) throw new Error("Invalid evidence key");
      try {
        await unlink(join(directory, storage_key));
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )) {
          failures++;
          continue;
        }
      }
      await client.query("DELETE FROM evidence_gc WHERE storage_key = $1", [
        storage_key,
      ]);
    }
    console.log(
      `Redacted ${count} reports. Evidence removals pending: ${failures}.`,
    );
    if (failures) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
