import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, vi } from "vitest";

const connectionString = process.env.RLS_TEST_DATABASE_URL;

test.skipIf(!connectionString)(
  "report services enforce reviewer access and award a validation exactly once",
  async () => {
    const fixture = new Client({ connectionString });
    const runtime = new URL(connectionString!);
    runtime.searchParams.set("options", "-c role=bossob_app");
    vi.stubEnv("DATABASE_URL", runtime.href);
    const { db } = await import("../../db");
    const service = await import("./reports");
    const [owner, reviewer, outsider, org, program, scope, report] = Array.from(
      { length: 7 },
      () => randomUUID(),
    );
    await fixture.connect();

    try {
      await fixture.query("BEGIN");
      await fixture.query("INSERT INTO users (id) VALUES ($1),($2),($3)", [
        owner,
        reviewer,
        outsider,
      ]);
      await fixture.query(
        "INSERT INTO org_units (id,name,slug) VALUES ($1,'Service fixture',$1::uuid::text)",
        [org],
      );
      await fixture.query(
        "INSERT INTO programs (id,org_id,name,slug) VALUES ($1,$2,'Service fixture','service-fixture')",
        [program, org],
      );
      await fixture.query(
        "INSERT INTO program_scopes (id,program_id,name) VALUES ($1,$2,'Service fixture')",
        [scope, program],
      );
      await fixture.query(
        "INSERT INTO program_memberships VALUES ($1,$2,'triager')",
        [program, reviewer],
      );
      await fixture.query(
        `INSERT INTO reports (id,program_id,reporter_id,asset_id,title,description,cwe,steps,impact,proposed_severity,status)
        VALUES ($1,$2,$3,$4,'Fixture','Fixture','CWE-200','Fixture','Fixture','medium','triage')`,
        [report, program, owner, scope],
      );
      await fixture.query("COMMIT");

      await expect(service.getReport(outsider, report)).rejects.toMatchObject({
        status: 404,
      });
      expect(
        (await service.listReports(outsider, { programId: program })).items,
      ).toEqual([]);
      await expect(
        service.addComment(owner, report, { body: "Internal", internal: true }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.transitionReport(owner, report, {
          status: "validated",
          severity: "medium",
        }),
      ).rejects.toMatchObject({ status: 404 });

      await service.addComment(reviewer, report, {
        body: "Internal",
        internal: true,
      });
      expect((await service.listReportComments(owner, report)).items).toEqual(
        [],
      );
      expect(
        (await service.listReportComments(reviewer, report)).items,
      ).toMatchObject([{ body: "Internal", internal: true }]);

      await service.addComment(owner, report, { body: "Public" });
      const firstPage = await service.listReportComments(reviewer, report, {
        limit: 1,
      });
      expect(firstPage.items).toMatchObject([{ body: "Internal" }]);
      expect(firstPage.nextCursor).toBeTruthy();
      const secondPage = await service.listReportComments(reviewer, report, {
        limit: 1,
        cursor: firstPage.nextCursor!,
      });
      expect(secondPage).toMatchObject({
        items: [{ body: "Public" }],
        nextCursor: null,
      });

      const outcomes = await Promise.allSettled([
        service.transitionReport(reviewer, report, {
          status: "validated",
          severity: "medium",
        }),
        service.transitionReport(reviewer, report, {
          status: "validated",
          severity: "medium",
        }),
      ]);
      expect(
        outcomes.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      expect(await service.getReport(owner, report)).toMatchObject({
        status: "validated",
        severity: "medium",
      });
      const { rows } = await fixture.query(
        "SELECT points, actor_id FROM score_events WHERE report_id=$1",
        [report],
      );
      expect(rows).toEqual([{ points: 200, actor_id: reviewer }]);
    } finally {
      try {
        await fixture.query("ROLLBACK");
        await fixture.query("BEGIN");
        await fixture.query("DELETE FROM report_events WHERE report_id=$1", [
          report,
        ]);
        await fixture.query("DELETE FROM report_comments WHERE report_id=$1", [
          report,
        ]);
        await fixture.query(
          "DELETE FROM achievement_award_history WHERE award_id IN (SELECT id FROM achievement_awards WHERE user_id=$1)",
          [owner],
        );
        await fixture.query("DELETE FROM achievement_awards WHERE user_id=$1", [
          owner,
        ]);
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
        await fixture.query("DELETE FROM users WHERE id IN ($1,$2,$3)", [
          owner,
          reviewer,
          outsider,
        ]);
        await fixture.query("COMMIT");
      } finally {
        await fixture.end();
        await db.$client.end();
        vi.unstubAllEnvs();
      }
    }
  },
);
