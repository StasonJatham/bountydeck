import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withActor } from "../../db";
import { accounts } from "../../db/schema";

export type IntegrationPrincipal = {
  actorId: string;
  clientId: string;
  subject: string;
  actorType: "delegated" | "service";
};

export class IntegrationAuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    public readonly code:
      | "invalid_token"
      | "insufficient_scope"
      | "identity_unavailable"
      | "authentication_unavailable",
  ) {
    super(code);
  }
}

const unavailable = () =>
  new IntegrationAuthError(503, "authentication_unavailable");
const invalidToken = () => new IntegrationAuthError(401, "invalid_token");

const issuerDiscovery = z.object({
  issuer: z.string(),
  introspection_endpoint: z.string(),
});

const claimText = z.string().min(1).max(512);
const clientIdentifier = z.string().min(1).max(255);
const introspectionResponse = z.object({
  active: z.literal(true),
  iss: claimText,
  sub: claimText,
  aud: z.union([claimText, z.array(claimText).max(64)]),
  exp: z.number().int(),
  nbf: z.number().int().optional(),
  client_id: clientIdentifier.optional(),
  azp: clientIdentifier.optional(),
  scope: z.string().max(4096).optional(),
  token_type: claimText.optional(),
  typ: claimText.optional(),
  token_use: claimText.optional(),
  grant_type: claimText.optional(),
  cnf: z.unknown().optional(),
});

let discoveryCache:
  { issuer: string; endpoint: string; expires: number } | undefined;

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.body) throw unavailable();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 32768) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw unavailable();
  }
}

async function introspectionEndpoint(issuer: string) {
  if (
    discoveryCache?.issuer === issuer &&
    discoveryCache.expires > Date.now()
  ) {
    return discoveryCache.endpoint;
  }
  const source = new URL(issuer);
  const loopback =
    process.env.INTEGRATION_ALLOW_HTTP === "true" &&
    [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "bountydeck.test",
      "bossob.test",
    ].includes(source.hostname);
  if (
    (source.protocol !== "https:" &&
      !(loopback && source.protocol === "http:")) ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  ) {
    throw unavailable();
  }
  const discovery = issuerDiscovery.safeParse(
    await fetchJson(
      `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    ),
  );
  if (!discovery.success || discovery.data.issuer !== issuer)
    throw unavailable();
  const endpoint = new URL(discovery.data.introspection_endpoint);
  if (
    endpoint.origin !== source.origin ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw unavailable();
  }
  discoveryCache = {
    issuer,
    endpoint: endpoint.href,
    expires: Date.now() + 300_000,
  };
  return endpoint.href;
}

function integrationConfig() {
  try {
    const issuer = process.env.OIDC_ISSUER;
    const audience = process.env.INTEGRATION_AUDIENCE;
    const scope = process.env.INTEGRATION_SCOPE || "bountydeck.api";
    const clientId = process.env.INTEGRATION_INTROSPECTION_CLIENT_ID;
    const secretFile = process.env.INTEGRATION_INTROSPECTION_CLIENT_SECRET_FILE;
    const secret = secretFile
      ? readFileSync(secretFile, "utf8").trim()
      : process.env.INTEGRATION_INTROSPECTION_CLIENT_SECRET;
    const services = z
      .record(claimText, claimText)
      .parse(JSON.parse(process.env.INTEGRATION_SERVICE_CLIENTS || "{}"));
    if (
      !issuer ||
      !audience ||
      !clientId ||
      !secret ||
      !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope)
    ) {
      throw unavailable();
    }
    return { issuer, audience, scope, clientId, secret, services };
  } catch {
    throw unavailable();
  }
}

const encodeBasic = (value: string) =>
  new URLSearchParams({ v: value }).toString().slice(2);

export function validateIntrospection(
  value: unknown,
  config: Pick<
    ReturnType<typeof integrationConfig>,
    "issuer" | "audience" | "scope" | "services"
  >,
  now = Date.now() / 1000,
) {
  const parsed = introspectionResponse.safeParse(value);
  if (!parsed.success) throw invalidToken();
  const token = parsed.data;
  const audience = Array.isArray(token.aud) ? token.aud : [token.aud];
  const types = [token.token_type, token.typ].filter(
    (kind) => kind !== undefined,
  );
  const clientId = token.client_id ?? token.azp;
  if (
    token.iss !== config.issuer ||
    !audience.includes(config.audience) ||
    token.exp <= now ||
    (token.nbf !== undefined && token.nbf > now) ||
    types.length === 0 ||
    types.some((type) => type.toLowerCase() !== "bearer") ||
    (token.token_use !== undefined && token.token_use !== "access") ||
    token.cnf !== undefined ||
    !clientId ||
    (token.azp !== undefined && token.azp !== clientId)
  ) {
    throw invalidToken();
  }
  if (!token.scope?.split(" ").includes(config.scope)) {
    throw new IntegrationAuthError(403, "insufficient_scope");
  }
  const service = Object.hasOwn(config.services, clientId);
  if (
    (service && config.services[clientId] !== token.sub) ||
    (!service && token.grant_type === "client_credentials")
  ) {
    throw new IntegrationAuthError(403, "identity_unavailable");
  }
  return {
    subject: token.sub,
    clientId,
    actorType: service ? ("service" as const) : ("delegated" as const),
  };
}

export async function authenticateIntegration(
  request: Request,
): Promise<IntegrationPrincipal> {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 16384) throw invalidToken();
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization);
  if (!match) throw invalidToken();
  const config = integrationConfig();
  let response: unknown;
  try {
    const endpoint = await introspectionEndpoint(config.issuer);
    const basic = Buffer.from(
      `${encodeBasic(config.clientId)}:${encodeBasic(config.secret)}`,
    ).toString("base64");
    response = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        token: match[1],
        token_type_hint: "access_token",
      }),
    });
  } catch {
    throw unavailable();
  }
  const identity = validateIntrospection(response, config);
  const provider =
    identity.actorType === "service"
      ? `oauth-service:${config.issuer}`
      : `oidc:${config.issuer}`;
  const [account] = await db
    .select({ actorId: accounts.userId })
    .from(accounts)
    .where(
      and(
        eq(accounts.provider, provider),
        eq(accounts.providerAccountId, identity.subject),
      ),
    );
  if (!account) throw new IntegrationAuthError(403, "identity_unavailable");
  if (identity.actorType === "service") {
    const active = await withActor(account.actorId, async (tx) => {
      const {
        rows: [membership],
      } = await tx.execute<{ associated: boolean }>(sql`
        select exists (select 1 from org_memberships where user_id = app_actor())
          or exists (select 1 from program_memberships where user_id = app_actor()) as associated
      `);
      return membership.associated;
    });
    if (!active) throw new IntegrationAuthError(403, "identity_unavailable");
  }
  return { actorId: account.actorId, ...identity };
}
