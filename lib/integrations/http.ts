import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor, withActorTransaction } from "../../db";
import {
  integrationAudit,
  programs,
  reportAttachments,
  reports,
} from "../../db/schema";
import type { IntegrationPrincipal } from "./auth";
import { IntegrationError, integrationFailure } from "./errors";
import type { Operation } from "./operations";

export function integrationOrigin() {
  const base = process.env.AUTH_URL;
  if (!base) throw new IntegrationError(503, "integration_unavailable");
  const url = URL.parse(base);
  if (
    !url ||
    url.username ||
    url.password ||
    url.href !== `${url.origin}/` ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        process.env.INTEGRATION_ALLOW_HTTP === "true" &&
        [
          "localhost",
          "127.0.0.1",
          "[::1]",
          "bountydeck.test",
          "bossob.test",
        ].includes(url.hostname)
      ))
  ) {
    throw new IntegrationError(503, "integration_unavailable");
  }
  return url;
}

export function protectTransport(request: Request) {
  const base = integrationOrigin();
  if (process.env.INTEGRATION_AUDIENCE !== `${base.origin}/mcp`)
    throw new IntegrationError(503, "integration_unavailable");
  const origin = request.headers.get("origin");
  if (
    request.headers.get("host") !== base.host ||
    (origin !== null && origin !== base.origin)
  ) {
    throw new IntegrationError(403, "origin_denied");
  }
}

export function problem(
  error: unknown,
  requestId = randomUUID(),
  options: { challenge?: boolean } = {},
) {
  const failure = integrationFailure(error);
  const headers = new Headers({
    "Content-Type": "application/problem+json",
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
  });
  if (failure.status === 429) headers.set("Retry-After", "60");
  if (
    options.challenge &&
    (failure.status === 401 || failure.code === "insufficient_scope")
  ) {
    try {
      const scope = process.env.INTEGRATION_SCOPE || "bountydeck.api";
      const scopeChallenge =
        failure.status === 403
          ? `, error="insufficient_scope", scope="${scope}"`
          : "";
      headers.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${integrationOrigin().origin}/.well-known/oauth-protected-resource/mcp"${scopeChallenge}`,
      );
    } catch {
      headers.set("WWW-Authenticate", "Bearer");
    }
  }
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title:
        new Response(null, { status: failure.status }).statusText ||
        (
          {
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Not Found",
            409: "Conflict",
            413: "Content Too Large",
            415: "Unsupported Media Type",
            422: "Unprocessable Content",
            429: "Too Many Requests",
            500: "Internal Server Error",
            503: "Service Unavailable",
          } as Record<number, string>
        )[failure.status] ||
        "Request failed",
      status: failure.status,
      code: failure.code,
      requestId,
    }),
    { status: failure.status, headers },
  );
}

export async function readJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (!request.body) return {};
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new IntegrationError(415, "json_required");
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new IntegrationError(413, "body_too_large");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new IntegrationError(413, "body_too_large");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
    );
  } catch {
    throw new IntegrationError(400, "invalid_json");
  }
}

export async function consumeRate(principal: IntegrationPrincipal) {
  const result = await withActor(principal.actorId, (tx) =>
    tx.execute<{ requests: number }>(sql`
    insert into integration_request_windows (actor_id, starts_at, requests) values (${principal.actorId}, date_trunc('minute', now()), 1)
    on conflict (actor_id) do update set starts_at = greatest(integration_request_windows.starts_at, excluded.starts_at),
      requests = case when integration_request_windows.starts_at >= excluded.starts_at then integration_request_windows.requests + 1 else 1 end
      where integration_request_windows.starts_at < excluded.starts_at or integration_request_windows.requests < 120
    returning requests
  `),
  );
  if (!result.rows.length) throw new IntegrationError(429, "rate_limited");
}

function audit(
  principal: IntegrationPrincipal,
  operation: Operation,
  input: Record<string, unknown>,
  requestId: string,
  outcome: number,
) {
  const candidate =
    input.reportId ??
    input.attachmentId ??
    input.programId ??
    input.organizationId;
  const resourceId = z.uuid().safeParse(candidate);
  return withActor(principal.actorId, async (tx) => {
    let programId: string | null = null;
    let organizationId: string | null = null;
    if (resourceId.success) {
      if (input.reportId !== undefined) {
        const [report] = await tx
          .select({ id: reports.programId })
          .from(reports)
          .where(eq(reports.id, resourceId.data));
        programId = report?.id ?? null;
      } else if (input.attachmentId !== undefined) {
        const [report] = await tx
          .select({ id: reports.programId })
          .from(reportAttachments)
          .innerJoin(reports, eq(reports.id, reportAttachments.reportId))
          .where(eq(reportAttachments.id, resourceId.data));
        programId = report?.id ?? null;
      } else if (input.programId !== undefined) {
        programId = resourceId.data;
      } else if (input.organizationId !== undefined && outcome < 400) {
        organizationId = resourceId.data;
      }
      if (programId) {
        const [program] = await tx
          .select({ organizationId: programs.orgId })
          .from(programs)
          .where(eq(programs.id, programId));
        organizationId = program?.organizationId ?? null;
        if (!program) programId = null;
      }
    }
    await tx.insert(integrationAudit).values({
      actorId: principal.actorId,
      actorType: principal.actorType,
      clientId: principal.clientId,
      operation: operation.name,
      resourceId: resourceId.success ? resourceId.data : null,
      programId,
      organizationId,
      requestId,
      outcome,
    });
  });
}

export async function executeOperation(
  principal: IntegrationPrincipal,
  operation: Operation,
  input: Record<string, unknown>,
  requestId: string,
  requestKey?: string,
): Promise<unknown> {
  try {
    if (requestKey && !/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey))
      throw new IntegrationError(422, "invalid_idempotency_key");
    if (
      operation.method === "GET" ||
      operation.name === "bountydeck_upload_attachment"
    ) {
      const data = await operation.execute(principal, input);
      if (data instanceof Response && !data.ok)
        throw new IntegrationError(
          data.status === 404 ? 404 : 503,
          "evidence_unavailable",
        );
      await audit(principal, operation, input, requestId, operation.status);
      return data;
    }
    return await withActorTransaction(principal.actorId, async (tx) => {
      const { actorId, clientId } = principal;
      const fingerprint = requestKey
        ? createHash("sha256")
            .update(
              JSON.stringify([operation.name, operation.input.parse(input)]),
            )
            .digest("hex")
        : null;
      if (requestKey) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actorId, clientId, requestKey])}, 0))`,
        );
        await tx.execute(
          sql`delete from integration_idempotency where actor_id = ${actorId} and created_at < now() - interval '24 hours'`,
        );
        const existing = (
          await tx.execute<{ fingerprint: string; response: unknown }>(sql`
          select fingerprint, response from integration_idempotency
          where actor_id = ${actorId} and client_id = ${clientId} and request_key = ${requestKey}
        `)
        ).rows[0];
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new IntegrationError(409, "idempotency_conflict");
          await audit(principal, operation, input, requestId, operation.status);
          return existing.response;
        }
      }
      const result = await operation.execute(principal, input);
      if (requestKey) {
        await tx.execute(sql`insert into integration_idempotency (actor_id, client_id, request_key, fingerprint, response)
          values (${actorId}, ${clientId}, ${requestKey}, ${fingerprint}, ${JSON.stringify(result)}::jsonb)`);
      }
      await audit(principal, operation, input, requestId, operation.status);
      return result;
    });
  } catch (error) {
    const failure =
      error instanceof z.ZodError
        ? new IntegrationError(422, "invalid_input")
        : integrationFailure(error);
    await audit(principal, operation, input, requestId, failure.status).catch(
      () => {},
    );
    if (failure.status >= 500)
      console.error("Integration operation failed", {
        requestId,
        operation: operation.name,
        status: failure.status,
      });
    throw failure;
  }
}

export function jsonResult(data: unknown, status: number, requestId: string) {
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };
  if (data instanceof Response) {
    const response = new Response(data.body, {
      status: data.status,
      headers: data.headers,
    });
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  }
  const content = JSON.stringify(data);
  if (Buffer.byteLength(content) > 4 * 1024 * 1024)
    throw new IntegrationError(413, "response_too_large");
  return new Response(content, {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
