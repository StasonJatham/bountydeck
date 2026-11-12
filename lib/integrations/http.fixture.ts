import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { Client } from "pg";
import { expect } from "vitest";

const origin = "http://bountydeck.test";
const fixtureId = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

type RpcResult = {
  error?: { code: number };
  result?: {
    tools?: { name: string }[];
    structuredContent?: { data: unknown };
    content?: { text: string }[];
    contents?: { uri: string; text: string }[];
    isError?: boolean;
  };
};

export async function exerciseIntegrationHttp(
  service: string,
  delegated: string,
  browserPage: Page,
) {
  const admin = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(readFileSync("secrets/db_admin_password", "utf8").trim())}@127.0.0.1:55432/bountydeck`,
  });
  const [report, unrelated, attachment, notification] = Array.from(
    { length: 4 },
    () => randomUUID(),
  );
  const serviceActor = readFileSync(
    "secrets/test_integration_service_actor",
    "utf8",
  ).trim();
  const marker = `Synthetic integration test ${report}`;
  let rpcId = 0;
  const api = (
    path: string,
    token: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      key?: string;
    } = {},
  ) =>
    fetch(`${origin}/api/v1${path}`, {
      method: options.method,
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(options.body && { "Content-Type": "application/json" }),
        ...(options.key && { "Idempotency-Key": options.key }),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  const rpc = async (
    token: string,
    method: string,
    params: Record<string, unknown>,
    key?: string,
  ) => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(key && { "Idempotency-Key": key }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<RpcResult>;
  };
  const call = (
    token: string,
    name: string,
    args: Record<string, unknown>,
    key?: string,
  ) =>
    rpc(
      token,
      "tools/call",
      { name: `bountydeck_${name}`, arguments: args },
      key,
    );

  await admin.connect();
  try {
    const issuer = `oidc:${origin}/identity/realms/bountydeck`;
    for (const [id, program, scope, owner] of [
      [report, fixtureId(11), fixtureId(21), fixtureId(101)],
      [unrelated, fixtureId(12), fixtureId(23), fixtureId(104)],
    ]) {
      const result = await admin.query(
        `INSERT INTO reports (id, program_id, asset_id, reporter_id, title, description, cwe, steps, impact, proposed_severity)
         SELECT $1,$2,$3,user_id,$4,'Synthetic fixture','CWE-200','Fixture only','Fixture only','low'
         FROM accounts WHERE provider = $5 AND provider_account_id = $6`,
        [id, program, scope, marker, issuer, owner],
      );
      expect(result.rowCount).toBe(1);
    }
    await admin.query(
      `INSERT INTO report_attachments (id, report_id, uploaded_by, name, media_type, size)
       SELECT $1, id, reporter_id, 'private-fixture.txt', 'text/plain', 12 FROM reports WHERE id = $2`,
      [attachment, unrelated],
    );
    await admin.query(
      `INSERT INTO notification_channels (id, program_id, kind, destination, signing_secret, subscribed_events)
       VALUES ($1,$2,'webhook','https://fixture.invalid',repeat('x',32),ARRAY['report.validated'])`,
      [notification, fixtureId(11)],
    );

    const anonymous = await api("/identity", "");
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("WWW-Authenticate")).toContain(
      "oauth-protected-resource/mcp",
    );
    expect((await api("/identity", "invalid-fixture-token")).status).toBe(401);
    const unauthorizedMcp = await fetch(`${origin}/mcp`, { method: "POST" });
    expect(unauthorizedMcp.status).toBe(401);
    const discovery = await fetch(
      `${origin}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(await discovery.json()).toMatchObject({
      resource: `${origin}/mcp`,
      scopes_supported: ["bountydeck.api"],
    });

    expect((await fetch(`${origin}/api/openapi.json`)).status).toBe(401);
    const specification = await fetch(`${origin}/api/openapi.json`, {
      headers: { Authorization: `Bearer ${delegated}` },
    });
    expect(specification.status).toBe(200);
    expect(await specification.json()).toHaveProperty("paths");
    await browserPage.goto(`${origin}/sign-in`);
    await browserPage
      .getByRole("button", { name: "Sign in with Company account" })
      .click();
    await browserPage.waitForURL(`${origin}/dashboard`);
    await browserPage.goto(`${origin}/reports/${report}`);
    await browserPage.getByRole("heading", { name: marker }).waitFor();

    for (const [token, actorType] of [
      [service, "service"],
      [delegated, "delegated"],
    ]) {
      const restIdentity = await api("/identity", token);
      expect(restIdentity.status).toBe(200);
      const identity = await restIdentity.json();
      expect(identity).toMatchObject({
        actorType,
        programRoles: expect.arrayContaining([
          expect.objectContaining({
            role: "triager",
            programId: fixtureId(11),
          }),
        ]),
      });
      const init = await rpc(token, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "bountydeck-local-fixture", version: "1" },
      });
      expect(init.result).toBeDefined();
      const tools = await rpc(token, "tools/list", {});
      expect(tools.result?.tools).toContainEqual(
        expect.objectContaining({ name: "bountydeck_get_report" }),
      );
      expect(
        (await call(token, "get_identity", {})).result?.structuredContent?.data,
      ).toEqual(identity);
      const search = await api(
        `/reports?${new URLSearchParams({ search: marker, limit: "1" })}`,
        token,
      );
      expect(await search.json()).toMatchObject({
        items: [expect.objectContaining({ id: report })],
      });
      const restReport = await api(`/reports/${report}`, token);
      expect(restReport.status).toBe(200);
      expect(
        (await call(token, "get_report", { reportId: report })).result
          ?.structuredContent?.data,
      ).toEqual(await restReport.json());
      const reportUri = `bountydeck://reports/${report}`;
      const resource = await rpc(token, "resources/read", { uri: reportUri });
      expect(resource.result?.contents?.[0]?.uri).toBe(reportUri);
      expect(
        JSON.parse(resource.result?.contents?.[0]?.text ?? "{}"),
      ).toMatchObject({ id: report, title: marker });
      const privateResource = await rpc(token, "resources/read", {
        uri: `bountydeck://reports/${unrelated}`,
      });
      expect(privateResource.result).toBeUndefined();
      expect(privateResource.error).toBeDefined();
      const workflow = await rpc(token, "resources/read", {
        uri: "bountydeck://triage-workflow",
      });
      expect(
        JSON.parse(workflow.result?.contents?.[0]?.text ?? "{}"),
      ).toHaveProperty("triage");
      const programResource = await rpc(token, "resources/read", {
        uri: `bountydeck://programs/${fixtureId(11)}`,
      });
      expect(programResource.result?.contents?.[0]?.text).toContain(
        "Web Applications",
      );
      expect((await api(`/reports/${unrelated}`, token)).status).toBe(404);
      const denied = await call(token, "get_report", { reportId: unrelated });
      expect(denied.result?.isError).toBe(true);
      expect(
        JSON.parse(denied.result?.content?.[0]?.text ?? "{}"),
      ).toMatchObject({ status: 404 });
      expect((await api(`/attachments/${attachment}`, token)).status).toBe(404);
      expect(
        (
          await api("/organizations", token, {
            method: "POST",
            body: {
              name: "Denied fixture",
              slug: "denied-fixture",
              description: "",
            },
          })
        ).status,
      ).toBeOneOf([403, 404]);
    }

    const commentKey = `${report}:comment`;
    const note = { body: marker, internal: true };
    const posted = await api(`/reports/${report}/comments`, service, {
      method: "POST",
      body: note,
      key: commentKey,
    });
    expect(posted.status).toBe(201);
    const comment = await posted.json();
    const replayed = await call(
      service,
      "add_comment",
      { ...note, reportId: report },
      commentKey,
    );
    expect(replayed.result?.structuredContent?.data).toEqual(comment);
    expect(
      (
        await api(`/reports/${report}/comments`, service, {
          method: "POST",
          body: { ...note, body: "Different content" },
          key: commentKey,
        })
      ).status,
    ).toBe(409);
    await browserPage.reload();
    await browserPage
      .getByText(marker, { exact: true })
      .filter({ visible: true })
      .last()
      .waitFor();
    const comments = await api(`/reports/${report}/comments`, delegated);
    expect(await comments.json()).toMatchObject({
      items: [expect.objectContaining({ body: marker, internal: true })],
    });

    expect(
      (
        await api(`/reports/${report}/assignment`, service, {
          method: "PATCH",
          body: { assigneeId: serviceActor },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(service, "set_report_severity", {
          reportId: report,
          severity: "low",
        })
      ).result?.structuredContent?.data,
    ).toEqual({ ok: true });
    for (const status of [
      "triage",
      "validated",
      "remediation",
      "retesting",
      "resolved",
    ]) {
      const body = {
        status,
        ...(status === "validated" && { severity: "low" }),
      };
      const changed = await api(`/reports/${report}/status`, service, {
        method: "POST",
        body,
        key: `${report}:${status}`,
      });
      expect(changed.status).toBe(200);
    }
    const updated = await api(`/reports/${report}`, delegated);
    expect(await updated.json()).toMatchObject({
      status: "resolved",
      severity: "low",
      assigneeId: serviceActor,
    });
    const history = await api(`/reports/${report}/history`, service);
    expect(await history.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          kind: "report.validated",
          actorId: serviceActor,
        }),
      ]),
    });

    expect(
      (
        await admin.query(
          "SELECT actor_id, kind FROM score_events WHERE report_id = $1",
          [report],
        )
      ).rows,
    ).toEqual([{ actor_id: serviceActor, kind: "award" }]);
    expect(
      (
        await admin.query(
          "SELECT event_type FROM notification_outbox WHERE report_id = $1 AND channel_id = $2",
          [report, notification],
        )
      ).rows,
    ).toEqual([{ event_type: "report.validated" }]);
    expect(
      (
        await admin.query(
          "SELECT actor_id, actor_type, outcome FROM integration_audit WHERE request_id = $1",
          [posted.headers.get("X-Request-Id")],
        )
      ).rows,
    ).toEqual([
      { actor_id: serviceActor, actor_type: "service", outcome: 201 },
    ]);

    // Suspend only the two assignments owned by the disposable service fixture.
    const organization = fixtureId(1);
    const program = fixtureId(11);
    const [{ rows: orgRoles }, { rows: programRoles }] = await admin
      .query("BEGIN")
      .then(async () => {
        try {
          const removed = await Promise.all([
            admin.query<{ role: string }>(
              "DELETE FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND role = 'member' RETURNING role",
              [serviceActor, organization],
            ),
            admin.query<{ role: string }>(
              "DELETE FROM program_memberships WHERE user_id = $1 AND program_id = $2 AND role = 'triager' RETURNING role",
              [serviceActor, program],
            ),
          ]);
          await admin.query("COMMIT");
          return removed;
        } catch (error) {
          await admin.query("ROLLBACK");
          throw error;
        }
      });
    try {
      expect((await api("/identity", service)).status).toBe(403);
    } finally {
      if (orgRoles.length)
        await admin.query(
          "INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
          [organization, serviceActor],
        );
      if (programRoles.length)
        await admin.query(
          "INSERT INTO program_memberships (program_id, user_id, role) VALUES ($1, $2, 'triager') ON CONFLICT DO NOTHING",
          [program, serviceActor],
        );
    }
    expect((await api("/identity", service)).status).toBe(200);
  } finally {
    try {
      await admin.query("BEGIN");
      await admin.query(
        "SELECT id FROM notification_outbox WHERE report_id = $1 FOR UPDATE",
        [report],
      );
      await admin.query(
        "DELETE FROM notification_deliveries WHERE outbox_id IN (SELECT id FROM notification_outbox WHERE report_id = $1)",
        [report],
      );
      await admin.query(
        "DELETE FROM notification_outbox WHERE report_id = $1",
        [report],
      );
      await admin.query("DELETE FROM notification_channels WHERE id = $1", [
        notification,
      ]);
      for (const table of [
        "report_events",
        "report_comments",
        "report_attachments",
        "score_events",
      ]) {
        await admin.query(
          `DELETE FROM ${table} WHERE report_id = ANY($1::uuid[])`,
          [[report, unrelated]],
        );
      }
      await admin.query(
        "DELETE FROM integration_idempotency WHERE actor_id = $1 AND request_key LIKE $2",
        [serviceActor, `${report}:%`],
      );
      await admin.query(
        "DELETE FROM integration_audit WHERE resource_id = ANY($1::text[])",
        [[report, unrelated, attachment]],
      );
      await admin.query("DELETE FROM reports WHERE id = ANY($1::uuid[])", [
        [report, unrelated],
      ]);
      await admin.query("COMMIT");
    } finally {
      await admin.end();
    }
  }
}
