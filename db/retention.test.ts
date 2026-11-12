import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { expect, test } from "vitest";

const connectionString = process.env.RLS_TEST_DATABASE_URL;

test.skipIf(!connectionString)(
  "retention preserves active findings and removes expired content and evidence",
  async () => {
    const [actor, org, program, scope, expired, active, file] = Array.from(
      { length: 7 },
      () => randomUUID(),
    );
    const directory = await mkdtemp(join(tmpdir(), "bountydeck-retention-"));
    const client = new Client({ connectionString });
    await client.connect();
    const run = (...args: string[]) =>
      promisify(execFile)(
        process.execPath,
        ["deploy/retention.ts", org, "30", actor, ...args],
        {
          env: {
            ...process.env,
            RETENTION_DATABASE_URL: connectionString,
            ATTACHMENTS_DIR: directory,
          },
        },
      );

    try {
      await client.query(
        "INSERT INTO users (id, platform_role) VALUES ($1, 'admin')",
        [actor],
      );
      await client.query(
        "INSERT INTO org_units (id, slug, name) VALUES ($1, $1::uuid::text, 'Retention fixture')",
        [org],
      );
      await client.query(
        "INSERT INTO programs (id, org_id, slug, name) VALUES ($1, $2, 'retention', 'Retention fixture')",
        [program, org],
      );
      await client.query(
        "INSERT INTO program_scopes (id, program_id, name) VALUES ($1, $2, 'Test asset')",
        [scope, program],
      );
      await client.query(
        `INSERT INTO reports (id, program_id, reporter_id, asset_id, title, description, cwe, steps, impact, proposed_severity, status, updated_at)
       VALUES ($1,$3,$4,$5,'Expired','Private content','CWE-200','Synthetic','Synthetic','low','resolved', now() - interval '90 days'),
              ($2,$3,$4,$5,'Active','Active content','CWE-200','Synthetic','Synthetic','low','triage', now() - interval '90 days')`,
        [expired, active, program, actor, scope],
      );
      await client.query(
        "INSERT INTO report_comments (report_id, author_id, body) VALUES ($1,$2,'Private comment')",
        [expired, actor],
      );
      await client.query(
        "INSERT INTO report_attachments (report_id, uploaded_by, storage_key, name, media_type, size) VALUES ($1,$2,$3,'test.txt','text/plain',4)",
        [expired, actor, file],
      );
      await writeFile(join(directory, file), "test");

      expect((await run()).stdout).toContain("1 closed reports");
      expect(await readFile(join(directory, file), "utf8")).toBe("test");
      expect((await run("--apply")).stdout).toContain("Redacted 1 reports");
      expect(
        (
          await client.query(
            "SELECT title, description FROM reports WHERE id = $1",
            [expired],
          )
        ).rows,
      ).toEqual([{ title: "Report content expired", description: "" }]);
      expect(
        (
          await client.query("SELECT description FROM reports WHERE id = $1", [
            active,
          ])
        ).rows[0].description,
      ).toBe("Active content");
      expect(
        (
          await client.query(
            "SELECT FROM report_comments WHERE report_id = $1",
            [expired],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query(
            "SELECT FROM report_attachments WHERE report_id = $1",
            [expired],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query(
            "SELECT FROM audit_events WHERE actor_id = $1 AND kind = 'retention.applied'",
            [actor],
          )
        ).rowCount,
      ).toBe(1);
      await expect(readFile(join(directory, file))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect((await run()).stdout).toContain("0 closed reports");
    } finally {
      await client.query("DELETE FROM evidence_gc WHERE storage_key = $1", [
        file,
      ]);
      for (const table of [
        "report_events",
        "report_attachments",
        "report_comments",
      ]) {
        await client.query(`DELETE FROM ${table} WHERE report_id = $1`, [
          expired,
        ]);
      }
      await client.query("DELETE FROM audit_events WHERE actor_id = $1", [
        actor,
      ]);
      await client.query("DELETE FROM reports WHERE program_id = $1", [
        program,
      ]);
      await client.query("DELETE FROM program_scopes WHERE id = $1", [scope]);
      await client.query("DELETE FROM programs WHERE id = $1", [program]);
      await client.query("DELETE FROM org_units WHERE id = $1", [org]);
      await client.query("DELETE FROM users WHERE id = $1", [actor]);
      await client.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
