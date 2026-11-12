import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";

const connectionString = process.env.RLS_TEST_DATABASE_URL;

test.skipIf(!connectionString)(
  "concurrent validation deduplicates a report and recognizes a threshold across distinct reports",
  async () => {
    const fixture = new Client({ connectionString });
    const [researcher, triager, org, program, scope, report] = Array.from(
      { length: 6 },
      () => randomUUID(),
    );
    const extraReports = Array.from({ length: 4 }, () => randomUUID());
    const allReports = [report, ...extraReports];
    await fixture.connect();

    async function validate(target = report) {
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
          [target],
        );
        const result = await client.query(
          `INSERT INTO score_events (report_id,program_id,user_id,actor_id,kind,points,reason)
         VALUES ($1,$2,$3,$4,'award',200,'Validated') ON CONFLICT DO NOTHING RETURNING id`,
          [target, program, researcher, triager],
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
      const achievements = await fixture.query(
        "SELECT badge_id FROM achievement_awards WHERE user_id=$1",
        [researcher],
      );
      expect(achievements.rows).toEqual([{ badge_id: "first-signal" }]);

      await fixture.query(
        `INSERT INTO reports (id,program_id,reporter_id,asset_id,title,description,cwe,steps,impact,proposed_severity,status)
          SELECT id,$2,$3,$4,'Fixture','Fixture','CWE-200','Fixture','Fixture','medium','triage'
          FROM unnest($1::uuid[]) reports(id)`,
        [extraReports, program, researcher, scope],
      );
      await validate(extraReports[0]);
      await validate(extraReports[1]);
      expect(
        await Promise.all([
          validate(extraReports[2]),
          validate(extraReports[3]),
        ]),
      ).toEqual([1, 1]);
      const { rows: threshold } = await fixture.query(
        `SELECT count(*)::int AS awards FROM achievement_awards
          WHERE user_id=$1 AND badge_id='steady-hand' AND revoked_at IS NULL`,
        [researcher],
      );
      expect(threshold).toEqual([{ awards: 1 }]);
    } finally {
      try {
        await fixture.query("ROLLBACK");
        await fixture.query("BEGIN");
        await fixture.query(
          "DELETE FROM achievement_award_history WHERE award_id IN (SELECT id FROM achievement_awards WHERE user_id=$1)",
          [researcher],
        );
        await fixture.query("DELETE FROM achievement_awards WHERE user_id=$1", [
          researcher,
        ]);
        await fixture.query(
          "DELETE FROM score_events WHERE report_id=ANY($1)",
          [allReports],
        );
        await fixture.query("DELETE FROM reports WHERE id=ANY($1)", [
          allReports,
        ]);
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
