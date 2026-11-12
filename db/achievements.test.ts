import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";
import catalog from "../lib/achievements/catalog.json";

const connectionString = process.env.RLS_TEST_DATABASE_URL;

test.skipIf(!connectionString)(
  "reconciles achievement thresholds, corrections, reviewer checks and immutable seasons",
  async () => {
    const client = new Client({ connectionString });
    const [researcher, peer, outsider, triager, admin, org, otherOrg] =
      Array.from({ length: 7 }, () => randomUUID());
    const programs = Array.from({ length: 5 }, () => randomUUID());
    const scopes = programs.map(() => randomUUID());
    const reports = Array.from({ length: 50 }, () => randomUUID());
    await client.connect();

    async function actor(id: string) {
      await client.query("SET LOCAL ROLE bossob_app");
      await client.query("SELECT set_config('app.actor_id', $1, true)", [id]);
    }

    async function denied(query: string, args: unknown[] = []) {
      await client.query("SAVEPOINT denied_achievement");
      try {
        await expect(client.query(query, args)).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT denied_achievement");
        await client.query("RELEASE SAVEPOINT denied_achievement");
      }
    }

    async function badges() {
      const { rows } = await client.query<{ badge_id: string }>(
        "SELECT badge_id FROM app_achievement_awards() ORDER BY badge_id",
      );
      return rows.map(({ badge_id }) => badge_id);
    }

    async function report(
      id: string,
      owner: string,
      programIndex: number,
      severity: string,
      cwe: string,
      date: string,
    ) {
      await client.query(
        `INSERT INTO reports (id, program_id, reporter_id, asset_id, title, description, cwe, steps, impact,
          proposed_severity, severity, status, achievement_validated_at)
        VALUES ($1, $2, $3, $4, 'Fixture', 'Fixture', $5, 'Fixture', 'Fixture', 'critical', $6, 'remediation', $7)`,
        [
          id,
          programs[programIndex],
          owner,
          scopes[programIndex],
          cwe,
          severity,
          date,
        ],
      );
    }

    const score = `INSERT INTO score_events (report_id, program_id, user_id, actor_id, kind, points, reason, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'Achievement fixture', $7)`;

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (id, platform_role, leaderboard_visible)
          VALUES ($1, 'researcher', true), ($2, 'researcher', true), ($3, 'researcher', false),
            ($4, 'researcher', false), ($5, 'admin', false)`,
        [researcher, peer, outsider, triager, admin],
      );
      await client.query(
        "INSERT INTO org_units (id, name, slug) VALUES ($1, 'One', $1::uuid::text), ($2, 'Two', $2::uuid::text)",
        [org, otherOrg],
      );
      for (const [index, program] of programs.entries()) {
        await client.query(
          "INSERT INTO programs (id, org_id, name, slug, status, eligibility) VALUES ($1, $2, 'Fixture', $1::uuid::text, 'published', 'all')",
          [program, index === 4 ? otherOrg : org],
        );
        await client.query(
          "INSERT INTO program_scopes (id, program_id, name) VALUES ($1, $2, 'Fixture')",
          [scopes[index], program],
        );
        if (index !== 4) {
          await client.query(
            "INSERT INTO program_memberships VALUES ($1,$2,'triager'),($1,$3,'triager')",
            [program, triager, researcher],
          );
        }
      }

      const definitions = await client.query(
        "SELECT id, rule, catalog_version FROM achievement_definitions ORDER BY id",
      );
      expect(definitions.rows).toEqual(
        catalog.badges
          .map(({ id, rule }) => ({
            id,
            rule,
            catalog_version: catalog.catalog_version,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );

      const thresholds = new Map(
        [
          [1, "first-signal"],
          [5, "steady-hand"],
          [10, "bug-hunter"],
          [25, "bug-veteran"],
          [50, "bug-legend"],
        ].map(([threshold, badge]) => [Number(threshold), String(badge)]),
      );
      for (const [index, id] of reports.entries()) {
        await client.query("RESET ROLE");
        await report(
          id,
          researcher,
          index % 5,
          index < 3
            ? "critical"
            : index < 10
              ? "high"
              : index % 2
                ? "medium"
                : "low",
          `CWE-${(index % 5) + 100}`,
          ["2001-01-03", "2001-02-04", "2001-04-01"][index % 3],
        );
        const reached = thresholds.get(index + 1);
        const next = thresholds.get(index + 2);
        if (reached || next) {
          await actor(researcher);
          const earned = await badges();
          if (reached) expect(earned).toContain(reached);
          if (next) expect(earned).not.toContain(next);
        }
      }
      await actor(researcher);
      const automatic = await badges();
      expect(automatic).toEqual(
        expect.arrayContaining([
          "high-voltage",
          "critical-hit",
          "critical-mass",
          "impact-maker",
          "full-spectrum",
          "pathfinder",
          "explorer",
          "bridge-builder",
          "pattern-reader",
          "deep-diver",
          "back-again",
          "steady-signal",
          "season-hopper",
        ]),
      );
      expect(automatic).not.toContain("repro-ready");
      expect(automatic).not.toContain("quarter-champion");
      await denied("SELECT app_achievement_verify_repro($1,true)", [
        reports[0],
      ]);
      await denied("SELECT app_achievement_reconcile()");
      await denied("SELECT app_achievement_finalize('quarter', '2001-01-01')");
      await denied("SELECT app_achievement_feature(ARRAY['quarter-champion'])");

      await actor(triager);
      await denied("SELECT app_achievement_verify_repro($1,true)", [
        reports[4],
      ]);
      for (const index of [0, 1, 2, 3, 5]) {
        expect(
          (
            await client.query(
              "SELECT app_achievement_verify_repro($1,true) AS changed",
              [reports[index]],
            )
          ).rows,
        ).toEqual([{ changed: true }]);
      }
      expect(
        (
          await client.query(
            "SELECT app_achievement_verify_repro($1,true) AS changed",
            [reports[0]],
          )
        ).rows,
      ).toEqual([{ changed: false }]);
      await actor(researcher);
      expect(await badges()).toEqual(
        expect.arrayContaining(["repro-ready", "repro-pro"]),
      );

      await actor(triager);
      await client.query("UPDATE reports SET severity='low' WHERE id=$1", [
        reports[0],
      ]);
      await client.query("UPDATE reports SET status='triage' WHERE id=$1", [
        reports[1],
      ]);
      await actor(researcher);
      const corrected = await badges();
      for (const badge of [
        "critical-mass",
        "impact-maker",
        "bug-legend",
        "repro-pro",
      ]) {
        expect(corrected).not.toContain(badge);
      }
      expect(corrected).toContain("critical-hit");

      await client.query("RESET ROLE");
      await client.query(score, [
        reports[0],
        programs[0],
        researcher,
        triager,
        "award",
        249,
        "2001-01-03",
      ]);
      await actor(researcher);
      expect(await badges()).not.toContain("spark-250");
      for (const [points, badge] of [
        [1, "spark-250"],
        [750, "one-k-club"],
        [1500, "momentum"],
        [2500, "five-k-club"],
        [5000, "orbit"],
      ] as const) {
        await client.query("RESET ROLE");
        await client.query(score, [
          reports[0],
          programs[0],
          researcher,
          triager,
          "correction",
          points,
          "2001-01-03",
        ]);
        await actor(researcher);
        expect(await badges()).toContain(badge);
      }

      await client.query("RESET ROLE");
      const peerReport = randomUUID();
      await report(peerReport, peer, 0, "low", "CWE-100", "2001-01-04");
      await client.query(score, [
        peerReport,
        programs[0],
        peer,
        triager,
        "award",
        10000,
        "2001-01-04",
      ]);
      const outsiderReport = randomUUID();
      await report(outsiderReport, outsider, 0, "low", "CWE-100", "2001-01-04");
      await client.query(score, [
        outsiderReport,
        programs[0],
        outsider,
        triager,
        "award",
        20000,
        "2001-01-04",
      ]);
      await actor(peer);
      expect(await badges()).not.toContain("deep-diver");
      expect(await badges()).not.toContain("quarter-champion");

      await actor(admin);
      expect(
        (
          await client.query(
            "SELECT app_achievement_finalize('quarter', '2001-01-01') AS finalized",
          )
        ).rows,
      ).toEqual([{ finalized: true }]);
      expect(
        (
          await client.query(
            "SELECT app_achievement_finalize('year', '2001-01-01') AS finalized",
          )
        ).rows,
      ).toEqual([{ finalized: true }]);
      expect(
        (
          await client.query(
            "SELECT app_achievement_finalize('quarter', '2001-01-01') AS finalized",
          )
        ).rows,
      ).toEqual([{ finalized: false }]);
      for (const owner of [peer, researcher]) {
        await actor(owner);
        expect(await badges()).toEqual(
          expect.arrayContaining([
            "quarter-champion",
            "on-the-podium",
            "year-champion",
          ]),
        );
      }
      await actor(outsider);
      expect(await badges()).not.toContain("quarter-champion");
      await client.query("RESET ROLE");
      await client.query(score, [
        reports[0],
        programs[0],
        researcher,
        triager,
        "correction",
        1,
        "2001-04-02",
      ]);
      await actor(admin);
      expect(
        (
          await client.query(
            "SELECT app_achievement_finalize('quarter', '2001-04-01') AS finalized",
          )
        ).rows,
      ).toEqual([{ finalized: true }]);
      await client.query("RESET ROLE");
      await client.query(score, [
        reports[0],
        programs[0],
        researcher,
        triager,
        "correction",
        -9999,
        "2001-01-05",
      ]);
      await actor(researcher);
      expect(await badges()).not.toContain("orbit");
      expect(
        (await badges()).filter((badge) => badge === "quarter-champion"),
      ).toHaveLength(2);
      await client.query(
        "SELECT app_achievement_feature(ARRAY['quarter-champion'])",
      );
      const {
        rows: [champion],
      } = await client.query(
        "SELECT award_id, season, featured, seen FROM app_achievement_awards() WHERE badge_id = 'quarter-champion' AND season = 'quarter:2001-01-01'",
      );
      expect(champion).toMatchObject({
        season: "quarter:2001-01-01",
        featured: true,
        seen: false,
      });
      await actor(outsider);
      await client.query("SELECT app_achievement_seen(ARRAY[$1]::uuid[])", [
        champion.award_id,
      ]);
      await actor(researcher);
      expect(
        (
          await client.query(
            "SELECT seen FROM app_achievement_awards() WHERE award_id=$1",
            [champion.award_id],
          )
        ).rows,
      ).toEqual([{ seen: false }]);
      await client.query("SELECT app_achievement_seen(ARRAY[$1]::uuid[])", [
        champion.award_id,
      ]);
      expect(
        (
          await client.query(
            "SELECT seen FROM app_achievement_awards() WHERE award_id=$1",
            [champion.award_id],
          )
        ).rows,
      ).toEqual([{ seen: true }]);

      await client.query("RESET ROLE");
      const target =
        "SELECT id FROM achievement_awards WHERE user_id=$1 AND badge_id='first-signal'";
      await client.query(
        `DELETE FROM achievement_award_history WHERE award_id IN (${target})`,
        [researcher],
      );
      await client.query(
        `DELETE FROM achievement_awards WHERE id IN (${target})`,
        [researcher],
      );
      await actor(admin);
      expect(
        (await client.query("SELECT app_achievement_reconcile() AS changed"))
          .rows,
      ).toEqual([{ changed: 1 }]);
      expect(
        (await client.query("SELECT app_achievement_reconcile() AS changed"))
          .rows,
      ).toEqual([{ changed: 0 }]);
      await actor(researcher);
      expect(await badges()).toContain("first-signal");
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
  15000,
);
