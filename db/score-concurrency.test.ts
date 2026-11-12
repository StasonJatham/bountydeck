import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";

const connectionString = process.env.RLS_TEST_DATABASE_URL;

test.skipIf(!connectionString)(
  "concurrent validation can only produce one award",
  async () => {
    const fixture = new Client({ connectionString });
    const [researcher, triager, org, program, scope, report] = Array.from(
      { length: 6 },
      () => randomUUID(),
    );
    await fixture.connect();

    async function validate() {
      const client = new Client({ connectionString });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE bossob_app");
        await client.query("SELECT set_config('app.actor_id', $1, true)", [
          triager,
        ]);
        await client.query(
          "UPDATE reports SET status='validated', severity='medium' WHERE id=$1",
          [report],
        );
        const result = await client.query(
          `INSERT INTO score_events (report_id,program_id,user_id,actor_id,kind,points,reason)
         VALUES ($1,$2,$3,$4,'award',200,'Validated') ON CONFLICT DO NOTHING RETURNING id`,
          [report, program, researcher, triager],
        );
        await client.query("COMMIT");
        return result.rowCount;
      } finally {
        await client.end();
      }
    }

    try {
      await fixture.query("BEGIN");
      await fixture.query("INSERT INTO users (id) VALUES ($1),($2)", [
        researcher,
        triager,
      ]);
      await fixture.query(
        "INSERT INTO org_units (id,name,slug) VALUES ($1,'Concurrency fixture',$1::uuid::text)",
        [org],
      );
      await fixture.query(
        "INSERT INTO programs (id,org_id,name,slug) VALUES ($1,$2,'Concurrent validation','concurrent')",
        [program, org],
      );
      await fixture.query(
        "INSERT INTO program_scopes (id,program_id,name) VALUES ($1,$2,'Concurrency fixture')",
        [scope, program],
      );
      await fixture.query(
        "INSERT INTO program_memberships VALUES ($1,$2,'triager')",
        [program, triager],
      );
      await fixture.query(
        `INSERT INTO reports (id,program_id,reporter_id,asset_id,title,description,cwe,steps,impact,proposed_severity,status)
       VALUES ($1,$2,$3,$4,'Fixture','Fixture','CWE-200','Fixture','Fixture','medium','triage')`,
        [report, program, researcher, scope],
      );
      await fixture.query("COMMIT");

      const settled = await Promise.allSettled([validate(), validate()]);
      expect(settled).toEqual(
        expect.arrayContaining([
          { status: "fulfilled", value: 1 },
          { status: "fulfilled", value: 0 },
        ]),
      );
      const { rows } = await fixture.query(
        "SELECT points, award_severity FROM score_events WHERE report_id=$1",
        [report],
      );
      expect(rows).toEqual([{ points: 200, award_severity: "medium" }]);
    } finally {
      try {
        await fixture.query("ROLLBACK");
        await fixture.query("BEGIN");
        await fixture.query("DELETE FROM score_events WHERE report_id=$1", [
          report,
        ]);
        await fixture.query("DELETE FROM reports WHERE id=$1", [report]);
        await fixture.query(
          "DELETE FROM program_memberships WHERE program_id=$1",
          [program],
        );
        await fixture.query("DELETE FROM program_scopes WHERE id=$1", [scope]);
        await fixture.query("DELETE FROM programs WHERE id=$1", [program]);
        await fixture.query("DELETE FROM org_units WHERE id=$1", [org]);
        await fixture.query("DELETE FROM users WHERE id IN ($1,$2)", [
          researcher,
          triager,
        ]);
        await fixture.query("COMMIT");
      } finally {
        await fixture.end();
      }
    }
  },
);
