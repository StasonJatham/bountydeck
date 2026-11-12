import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";

const connectionString = process.env.RLS_TEST_DATABASE_URL;

test.skipIf(!connectionString)(
  "PostgreSQL isolates reports, evidence, notes, score writes, and notification settings",
  async () => {
    const client = new Client({ connectionString });
    await client.connect();
    const [
      researcher,
      peer,
      outsider,
      triager,
      otherManager,
      admin,
      org,
      otherOrg,
      program,
      otherProgram,
      scope,
      otherScope,
      report,
      peerReport,
      otherReport,
      attachment,
      channel,
    ] = Array.from({ length: 17 }, () => randomUUID());

    async function actor(id: string) {
      await client.query("select set_config('app.actor_id', $1, true)", [id]);
    }

    async function count(query: string, args: unknown[] = []) {
      return (await client.query(query, args)).rowCount;
    }

    async function denied(query: string, args: unknown[], code = "42501") {
      await client.query("SAVEPOINT denied_statement");
      try {
        await expect(client.query(query, args)).rejects.toMatchObject({
          code,
        });
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT denied_statement");
        await client.query("RELEASE SAVEPOINT denied_statement");
      }
    }

    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO users (id, name, leaderboard_visible) SELECT id, 'Researcher', id <> $2 FROM unnest($1::uuid[]) ids(id)",
        [[researcher, peer, outsider, triager, otherManager, admin], peer],
      );
      await client.query(
        "INSERT INTO org_units(id,name,slug) VALUES ($1,'Primary',$1::uuid::text),($2,'Secondary',$2::uuid::text)",
        [org, otherOrg],
      );
      await client.query("INSERT INTO org_memberships VALUES ($1,$2,'admin')", [
        org,
        admin,
      ]);
      await client.query(
        "INSERT INTO programs (id,org_id,name,slug,status,eligibility) VALUES ($1,$2,'Open','open','published','all'),($3,$4,'Private','private','published','invitation')",
        [program, org, otherProgram, otherOrg],
      );
      await client.query(
        "INSERT INTO program_memberships VALUES ($1,$2,'triager'),($3,$4,'manager'),($3,$5,'researcher')",
        [program, triager, otherProgram, otherManager, outsider],
      );
      await client.query(
        "INSERT INTO program_scopes (id,program_id,name) VALUES ($1,$2,'Primary asset'),($3,$4,'Secondary asset')",
        [scope, program, otherScope, otherProgram],
      );
      await client.query(
        "INSERT INTO notification_channels (id,program_id,kind,destination,subscribed_events) VALUES ($1,$2,'smtp','test@example.invalid',ARRAY['report.submitted','report.comment_added'])",
        [channel, program],
      );

      await client.query("SET LOCAL ROLE bossob_app");
      const { rows } = await client.query(
        "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
      );
      expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
      await actor(researcher);
      expect(
        await count(
          "UPDATE platform_settings SET report_exports = false RETURNING singleton",
        ),
      ).toBe(0);

      const submission = `INSERT INTO reports (id,program_id,reporter_id,asset_id,title,description,cwe,steps,impact,proposed_severity)
      VALUES ($1,$2,$3,$4,'Fixture','Confidential test data','CWE-200','Fixture','Fixture','low')`;
      await client.query(submission, [report, program, researcher, scope]);
      await denied(submission, [
        randomUUID(),
        otherProgram,
        researcher,
        otherScope,
      ]);
      await client.query(
        "INSERT INTO report_attachments (id,report_id,uploaded_by,name,media_type,size) VALUES ($1,$2,$3,'test.txt','text/plain',7)",
        [attachment, report, researcher],
      );
      await denied(
        "INSERT INTO report_comments (report_id,author_id,body,internal) VALUES ($1,$2,'Private',true)",
        [report, researcher],
      );
      expect(
        await count(
          "UPDATE reports SET status='validated' WHERE id=$1 RETURNING id",
          [report],
        ),
      ).toBe(0);
      await denied(
        "INSERT INTO score_events (report_id,program_id,user_id,actor_id,kind,points,reason) VALUES ($1,$2,$3,$3,'correction',1,'Forbidden')",
        [report, program, researcher],
      );
      expect(
        await count(
          "UPDATE notification_channels SET destination='denied@example.invalid' WHERE id=$1 RETURNING id",
          [channel],
        ),
      ).toBe(0);

      await actor(peer);
      await client.query(submission, [peerReport, program, peer, scope]);
      expect(await count("SELECT id FROM reports WHERE id=$1", [report])).toBe(
        0,
      );
      expect(
        await count("SELECT id FROM report_attachments WHERE id=$1", [
          attachment,
        ]),
      ).toBe(0);

      await actor(outsider);
      await client.query(submission, [
        otherReport,
        otherProgram,
        outsider,
        otherScope,
      ]);
      await actor(otherManager);
      expect(await count("SELECT id FROM reports WHERE id=$1", [report])).toBe(
        0,
      );
      expect(
        await count("SELECT id FROM report_attachments WHERE id=$1", [
          attachment,
        ]),
      ).toBe(0);
      expect(
        await count(
          "UPDATE programs SET name='Denied' WHERE id=$1 RETURNING id",
          [program],
        ),
      ).toBe(0);
      await client.query("UPDATE reports SET status='validated' WHERE id=$1", [
        otherReport,
      ]);
      await client.query(
        "INSERT INTO score_events (report_id,program_id,user_id,actor_id,kind,points,reason) VALUES ($1,$2,$3,$4,'award',200,'Fixture')",
        [otherReport, otherProgram, outsider, otherManager],
      );

      await actor(admin);
      expect(
        await count(
          "UPDATE org_units SET name='Denied' WHERE id=$1 RETURNING id",
          [otherOrg],
        ),
      ).toBe(0);
      expect(
        await count("SELECT id FROM reports WHERE id=$1", [otherReport]),
      ).toBe(0);

      await actor(triager);
      expect(
        await count("SELECT id FROM report_attachments WHERE id=$1", [
          attachment,
        ]),
      ).toBe(1);
      await client.query(
        "INSERT INTO report_comments (report_id,author_id,body,internal) VALUES ($1,$2,'Private',true),($1,$2,'Public',false)",
        [report, triager],
      );
      await client.query(
        "UPDATE reports SET status='validated', severity='critical' WHERE id IN ($1,$2)",
        [report, peerReport],
      );
      const award =
        "INSERT INTO score_events (report_id,program_id,user_id,actor_id,kind,points,reason) VALUES ($1,$2,$3,$4,'award',50,'Fixture') ON CONFLICT DO NOTHING RETURNING id";
      expect(await count(award, [report, program, researcher, triager])).toBe(
        1,
      );
      expect(await count(award, [report, program, researcher, triager])).toBe(
        0,
      );
      expect(await count(award, [peerReport, program, peer, triager])).toBe(1);
      const correction =
        "INSERT INTO score_events (report_id,program_id,user_id,actor_id,kind,points,reason) VALUES ($1,$2,$3,$4,'correction',$5,$6) RETURNING points";
      await denied(
        correction,
        [report, program, researcher, triager, -20, " "],
        "23514",
      );
      expect(
        await count(correction, [
          report,
          program,
          researcher,
          triager,
          -20,
          "Correct classification",
        ]),
      ).toBe(1);
      expect(
        await count(correction, [
          report,
          program,
          researcher,
          triager,
          20,
          "Reverse correction",
        ]),
      ).toBe(1);
      await denied("UPDATE score_events SET points=100 WHERE report_id=$1", [
        report,
      ]);
      await denied("UPDATE users SET platform_role='admin' WHERE id=$1", [
        triager,
      ]);

      await client.query("UPDATE reports SET severity='low' WHERE id=$1", [
        report,
      ]);
      await actor(researcher);
      expect(
        (
          await client.query(
            "SELECT award_severity FROM score_events WHERE report_id=$1 AND kind='award'",
            [report],
          )
        ).rows,
      ).toEqual([{ award_severity: "critical" }]);
      expect(
        (
          await client.query(
            "SELECT period, points, standing FROM app_personal_seasons() ORDER BY period",
          )
        ).rows,
      ).toEqual([
        { period: "quarter", points: "50", standing: "1" },
        { period: "year", points: "50", standing: "1" },
      ]);
      await denied("UPDATE users SET leaderboard_visible=true WHERE id=$1", [
        peer,
      ]);
      await client.query(
        "UPDATE users SET pseudonym='Test alias' WHERE id=$1",
        [researcher],
      );
      expect(await count("SELECT id FROM reports WHERE id=$1", [report])).toBe(
        1,
      );
      expect(
        await count(
          "SELECT id FROM report_comments WHERE report_id=$1 AND internal",
          [report],
        ),
      ).toBe(0);
      expect(
        await count(
          "SELECT id FROM report_comments WHERE report_id=$1 AND NOT internal",
          [report],
        ),
      ).toBe(1);
      expect(
        await count("SELECT id FROM score_events WHERE report_id=$1", [
          peerReport,
        ]),
      ).toBe(0);
      const { rows: leaderboard } = await client.query(
        "SELECT user_id, points, standing, is_self FROM app_leaderboard('global',NULL,'all')",
      );
      expect(leaderboard).toEqual([
        { user_id: researcher, points: "50", standing: "1", is_self: true },
      ]);
      expect(
        await count("SELECT * FROM app_leaderboard('program',$1,'all')", [
          otherProgram,
        ]),
      ).toBe(0);

      await client.query("SET LOCAL ROLE bossob_worker");
      await denied("SELECT id FROM reports WHERE id=$1", [report]);
      const { rows: events } = await client.query(
        "SELECT event_type FROM notification_outbox WHERE report_id=$1 ORDER BY event_type",
        [report],
      );
      expect(events).toEqual([
        { event_type: "report.comment_added" },
        { event_type: "report.submitted" },
      ]);

      await client.query("RESET ROLE");
      const { rows: privacy } = await client.query(
        "SELECT details FROM audit_events WHERE kind='profile.privacy_changed' AND actor_id=$1",
        [researcher],
      );
      expect(privacy).toEqual([
        { details: { visible: true, pseudonym_changed: true } },
      ]);
      await client.query(
        "UPDATE users SET leaderboard_visible=true WHERE id=$1",
        [peer],
      );
      await client.query("SET LOCAL ROLE bossob_app");
      const { rows: tied } = await client.query(
        "SELECT user_id, standing FROM app_leaderboard('global',NULL,'all')",
      );
      expect(tied).toEqual(
        [researcher, peer]
          .sort()
          .map((user_id) => ({ user_id, standing: "1" })),
      );
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);
