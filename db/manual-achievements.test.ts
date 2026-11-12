import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";

const connectionString = process.env.RLS_TEST_DATABASE_URL;

test.skipIf(!connectionString)(
  "manual recognition is scoped, audited, idempotent, and shares only opted-in awards",
  async () => {
    const client = new Client({ connectionString });
    const [
      researcher,
      manager,
      reviewer,
      unrelated,
      org,
      program,
      asset,
      report,
      secondReport,
    ] = Array.from({ length: 9 }, () => randomUUID());
    const grant =
      "SELECT app_set_manual_achievement($1, $2, $3, $4) AS changed";
    const argumentsFor = (revoke: boolean, target = report) => [
      target,
      "clear-signal",
      "Verified reporting quality",
      revoke,
    ];
    const peers = "SELECT id FROM app_shared_achievements($1)";

    async function actor(id: string) {
      await client.query("SELECT set_config('app.actor_id', $1, true)", [id]);
    }

    async function denied(code: string) {
      await client.query("SAVEPOINT denied_award");
      try {
        await expect(
          client.query(grant, argumentsFor(false)),
        ).rejects.toMatchObject({ code });
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT denied_award");
        await client.query("RELEASE SAVEPOINT denied_award");
      }
    }

    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO users (id) VALUES ($1), ($2), ($3), ($4)",
        [researcher, manager, reviewer, unrelated],
      );
      await client.query(
        "INSERT INTO org_units (id, name, slug) VALUES ($1, 'Recognition fixture', $1::uuid::text)",
        [org],
      );
      await client.query(
        "INSERT INTO programs (id, org_id, name, slug) VALUES ($1, $2, 'Private fixture', 'private-fixture')",
        [program, org],
      );
      await client.query(
        "INSERT INTO program_scopes (id, program_id, name) VALUES ($1, $2, 'Fixture asset')",
        [asset, program],
      );
      await client.query(
        "INSERT INTO program_memberships VALUES ($1, $2, 'manager'), ($1, $3, 'triager')",
        [program, manager, reviewer],
      );
      await client.query(
        `INSERT INTO reports (id, program_id, reporter_id, asset_id, title, description, cwe, steps, impact, proposed_severity, status, severity)
         VALUES ($1, $2, $3, $4, 'Fixture', 'Fixture', 'CWE-200', 'Fixture', 'Fixture', 'high', 'triage', 'high'),
          ($5, $2, $3, $4, 'Second fixture', 'Fixture', 'CWE-200', 'Fixture', 'Fixture', 'high', 'validated', 'high')`,
        [report, program, researcher, asset, secondReport],
      );

      await client.query("SET LOCAL ROLE bossob_app");
      await actor(researcher);
      await denied("42501");
      await actor(reviewer);
      await denied("42501");
      await actor(unrelated);
      await denied("42501");
      await actor(manager);
      await denied("55000");
      await client.query("UPDATE reports SET status='validated' WHERE id=$1", [
        report,
      ]);
      expect((await client.query(grant, argumentsFor(false))).rows).toEqual([
        { changed: true },
      ]);
      expect((await client.query(grant, argumentsFor(false))).rows).toEqual([
        { changed: false },
      ]);
      expect(
        (
          await client.query(
            "SELECT id FROM app_manual_achievements_for_report($1)",
            [report],
          )
        ).rows,
      ).toEqual([{ id: "clear-signal" }]);

      await client.query("RESET ROLE");
      await client.query(
        "INSERT INTO achievement_preferences (user_id, featured) VALUES ($1, ARRAY['clear-signal'])",
        [researcher],
      );
      await client.query("SET LOCAL ROLE bossob_app");
      await actor(reviewer);
      expect((await client.query(peers, [researcher])).rows).toEqual([]);

      await actor(researcher);
      await client.query(
        "UPDATE users SET pseudonym='Fixture pseudonym', leaderboard_visible=true WHERE id=$1",
        [researcher],
      );
      const ownManual =
        "SELECT award_id, seen FROM app_achievement_awards() WHERE badge_id='clear-signal'";
      const {
        rows: [firstManual],
      } = await client.query<{ award_id: string; seen: boolean }>(ownManual);
      expect(firstManual.seen).toBe(false);
      await client.query("SELECT app_achievement_seen($1)", [
        [firstManual.award_id],
      ]);
      await actor(manager);
      expect(
        (await client.query(grant, argumentsFor(false, secondReport))).rows,
      ).toEqual([{ changed: true }]);
      await actor(researcher);
      expect((await client.query(ownManual)).rows).toEqual([
        { award_id: expect.any(String), seen: true },
      ]);
      await actor(reviewer);
      expect((await client.query(peers, [researcher])).rows).toEqual([
        { id: "clear-signal" },
      ]);
      await actor(unrelated);
      expect((await client.query(peers, [researcher])).rows).toEqual([]);

      await actor(manager);
      await client.query("UPDATE reports SET status='triage' WHERE id=$1", [
        report,
      ]);
      expect((await client.query(grant, argumentsFor(true))).rows).toEqual([
        { changed: true },
      ]);
      expect((await client.query(grant, argumentsFor(true))).rows).toEqual([
        { changed: false },
      ]);
      await actor(researcher);
      expect((await client.query(ownManual)).rows).toEqual([
        { award_id: expect.any(String), seen: true },
      ]);
      await actor(manager);
      expect(
        (await client.query(grant, argumentsFor(true, secondReport))).rows,
      ).toEqual([{ changed: true }]);
      await actor(reviewer);
      expect((await client.query(peers, [researcher])).rows).toEqual([]);

      await client.query("RESET ROLE");
      expect(
        (
          await client.query(
            "SELECT action, actor_id FROM achievement_award_history WHERE award_id IN (SELECT id FROM achievement_awards WHERE source_key=$1) ORDER BY id",
            [report],
          )
        ).rows,
      ).toEqual([
        { action: "earned", actor_id: manager },
        { action: "revoked", actor_id: manager },
      ]);
      expect(
        (
          await client.query(
            "SELECT kind, details->>'reason' AS reason FROM audit_events WHERE org_id=$1 AND kind LIKE 'achievement.manual_%' AND details->>'reportId'=$2 ORDER BY kind",
            [org, report],
          )
        ).rows,
      ).toEqual([
        {
          kind: "achievement.manual_awarded",
          reason: "Verified reporting quality",
        },
        {
          kind: "achievement.manual_revoked",
          reason: "Verified reporting quality",
        },
      ]);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);
