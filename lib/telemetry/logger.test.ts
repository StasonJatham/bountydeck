import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { logRecord, otlpPayload } from "./logger";
import { loggedRoute } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const traceId = "0123456789abcdef0123456789abcdef";
const traceparent = `00-${traceId}-1234567890abcdef-01`;

test("emits ECS fields and maps UTC timestamps, severity and trace context to OTLP", () => {
  const record = logRecord(
    {
      service: "application",
      action: "http.request.completed",
      message: "HTTP request completed",
      level: "warn",
      outcome: "failure",
      durationNs: 1234,
      route: "/api/v1/[...segments]",
      status: 403,
      traceparent,
    },
    new Date("2026-01-01T00:00:00.000Z"),
  );
  expect(record).toMatchObject({
    "log.level": "warn",
    "event.outcome": "failure",
    "event.duration": 1234,
    "trace.id": traceId,
  });
  const [group] = otlpPayload([record]).resourceLogs;
  expect(group.resource.attributes).toContainEqual({
    key: "service.name",
    value: { stringValue: "bountydeck-application" },
  });
  expect(group.scopeLogs[0].logRecords[0]).toMatchObject({
    timeUnixNano: "1767225600000000000",
    severityNumber: 13,
    traceId,
  });
  expect(
    logRecord({
      service: "application",
      action: "test",
      message: "Test",
      traceparent: "untrusted",
    })["trace.id"],
  ).toBeUndefined();
});

test("logs a route template and request ID without headers, query values or bodies", async () => {
  vi.stubEnv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", "");
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  const handler = loggedRoute(
    "/api/evidence/[id]",
    async () => new Response("confidential-response-body", { status: 404 }),
  );
  const result = await handler(
    new Request(
      "https://example.test/api/evidence/private-id?code=private-query",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer private-token",
          Cookie: "private-session",
          traceparent,
        },
        body: "private-request-body",
      },
    ),
  );
  expect(await result.text()).toBe("confidential-response-body");
  const line = stdout.mock.calls[0][0] as string;
  expect(line).not.toMatch(/private-|confidential-response-body/);
  expect(JSON.parse(line)).toMatchObject({
    "http.route": "/api/evidence/[id]",
    "http.request.id": result.headers.get("X-Request-Id"),
    "http.response.status_code": 404,
    "trace.id": traceId,
  });
});

test("exports to a real local OTLP/HTTP receiver and keeps stdout if delivery fails", async () => {
  let body = "";
  let authorization: string | undefined;
  const receiver = createServer(async (request, response) => {
    for await (const chunk of request) body += chunk;
    authorization = request.headers.authorization;
    response.writeHead(503).end();
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  try {
    const address = receiver.address();
    if (!address || typeof address === "string")
      throw new Error("No receiver port");
    vi.stubEnv(
      "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
      `http://127.0.0.1:${address.port}/v1/logs`,
    );
    vi.stubEnv(
      "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
      "Authorization=Bearer%20fixture",
    );
    vi.resetModules();
    const { logEvent, flushLogs } = await import("./logger");
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    logEvent({
      service: "worker",
      action: "worker.started",
      message: "Worker started",
    });
    await flushLogs();
    expect(authorization).toBe("Bearer fixture");
    expect(
      JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords[0].body
        .stringValue,
    ).toBe("Worker started");
    expect(stdout).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0][0]).toContain("telemetry.export_failed");
    expect(body + stdout.mock.calls + stderr.mock.calls).not.toContain(
      "Bearer fixture",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
