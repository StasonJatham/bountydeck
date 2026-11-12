import { createHash, randomBytes } from "node:crypto";
import { createServer, request as requestHttp } from "node:http";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { afterAll, expect, it, vi } from "vitest";

const origin =
  process.env.INTEGRATION_FIXTURE_ORIGIN ?? "http://bountydeck.test";
const secretDirectory = process.env.INTEGRATION_FIXTURE_SECRETS ?? "secrets";
const databasePort = process.env.INTEGRATION_FIXTURE_DB_PORT ?? "55432";
const issuer = `${origin}/identity/realms/bountydeck`;
const loopback = new URL(origin);
loopback.hostname = "127.0.0.1";
const audience = `${origin}/mcp`;
const callback = "http://127.0.0.1:8765/callback";
const isCallback = (url: URL) => url.origin + url.pathname === callback;
const serviceClient = "bountydeck-fixture-service";
const delegatedClient = "bountydeck-fixture-delegated";
const fixture = process.env.RUN_INTEGRATION_AUTH_FIXTURE === "1";
const secret = (name: string) =>
  readFileSync(`${secretDirectory}/${name}`, "utf8").trim();

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.skipIf(!fixture)(
  "authenticates real Keycloak service and PKCE access tokens and rejects the ID token",
  async () => {
    vi.stubEnv("OIDC_ISSUER", issuer);
    vi.stubEnv("INTEGRATION_AUDIENCE", audience);
    vi.stubEnv("INTEGRATION_SCOPE", "bountydeck.api");
    vi.stubEnv("INTEGRATION_ALLOW_HTTP", "true");
    vi.stubEnv("INTEGRATION_INTROSPECTION_CLIENT_ID", "bountydeck");
    vi.stubEnv(
      "INTEGRATION_INTROSPECTION_CLIENT_SECRET",
      secret("oidc_client_secret"),
    );
    vi.stubEnv("INTEGRATION_INTROSPECTION_CLIENT_SECRET_FILE", "");
    vi.stubEnv(
      "INTEGRATION_SERVICE_CLIENTS",
      secret("test_integration_service_binding"),
    );
    vi.stubEnv(
      "DATABASE_URL",
      `postgresql://bossob_app:${encodeURIComponent(secret("db_app_password"))}@127.0.0.1:${databasePort}/bountydeck`,
    );

    // Route the fixture hostname to the Compose loopback listener without editing hosts.
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.origin !== origin) throw new Error("Unexpected fixture origin");
      const headers = new Headers(init?.headers);
      headers.set("Host", url.host);
      if (init?.body instanceof URLSearchParams)
        headers.set("Content-Type", "application/x-www-form-urlencoded");
      return new Promise<Response>((resolve, reject) => {
        const call = requestHttp(
          new URL(url.pathname + url.search, loopback),
          {
            method: init?.method,
            headers: Object.fromEntries(headers),
            signal: init?.signal ?? undefined,
          },
          (response) => {
            const responseHeaders = new Headers();
            for (
              let index = 0;
              index < response.rawHeaders.length;
              index += 2
            ) {
              responseHeaders.append(
                response.rawHeaders[index],
                response.rawHeaders[index + 1],
              );
            }
            const chunks: Uint8Array[] = [];
            response.on("data", (chunk: Uint8Array) => chunks.push(chunk));
            response.on("end", () =>
              resolve(
                new Response(chunks.length ? Buffer.concat(chunks) : null, {
                  status: response.statusCode,
                  headers: responseHeaders,
                }),
              ),
            );
            response.on("error", reject);
          },
        );
        call.on("error", reject);
        call.end(init?.body?.toString());
      });
    });
    const { authenticateIntegration } = await import("./auth");
    const { db } = await import("../../db");
    const authenticate = (token: string) =>
      authenticateIntegration(
        new Request(audience, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

    async function tokens(
      body: URLSearchParams,
    ): Promise<{ access_token: string; id_token?: string }> {
      const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
        method: "POST",
        body,
      });
      if (!response.ok)
        throw new Error(`Keycloak token exchange failed (${response.status})`);
      return response.json();
    }

    const browser = await chromium.launch({
      channel: process.env.INTEGRATION_CHROME_CHANNEL,
      args: [`--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`],
    });
    const callbackServer = createServer((_request, response) => {
      response.end("OAuth callback received");
    });
    try {
      await new Promise<void>((resolve, reject) => {
        callbackServer.once("error", reject);
        callbackServer.listen(8765, "127.0.0.1", resolve);
      });
      const service = await tokens(
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: serviceClient,
          client_secret: secret("test_integration_service_secret"),
          scope: "bountydeck.api",
        }),
      );
      await expect(authenticate(service.access_token)).resolves.toMatchObject({
        actorId: secret("test_integration_service_actor"),
        actorType: "service",
        clientId: serviceClient,
      });

      const page = await browser.newPage();
      const verifier = randomBytes(32).toString("base64url");
      const state = randomBytes(24).toString("base64url");
      const query = new URLSearchParams({
        response_type: "code",
        client_id: delegatedClient,
        redirect_uri: callback,
        scope: "openid bountydeck.api",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        state,
      });
      await page.goto(`${issuer}/protocol/openid-connect/auth?${query}`);
      await page.locator("#username").fill("local-triager");
      await page.locator("#password").fill(secret("test_user_password"));
      await page.locator("#kc-login").click();
      await page.waitForURL(isCallback, { timeout: 8000 });
      const result = new URL(page.url()).searchParams;
      expect(result.get("state")).toBe(state);
      const code = result.get("code");
      if (!code)
        throw new Error("Keycloak did not issue an authorization code");
      const delegated = await tokens(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: delegatedClient,
          redirect_uri: callback,
          code_verifier: verifier,
          code,
        }),
      );
      await expect(authenticate(delegated.access_token)).resolves.toMatchObject(
        {
          actorType: "delegated",
          clientId: delegatedClient,
          subject: "00000000-0000-4000-8000-000000000102",
        },
      );
      if (!delegated.id_token)
        throw new Error("OIDC exchange did not return an ID token");
      await expect(authenticate(delegated.id_token)).rejects.toMatchObject({
        status: 401,
      });
      if (process.env.RUN_INTEGRATION_HTTP_FIXTURE === "1") {
        const { exerciseIntegrationHttp } = await import("./http.fixture");
        await exerciseIntegrationHttp(
          service.access_token,
          delegated.access_token,
          page,
        );
      }
      const revoked = await fetch(`${issuer}/protocol/openid-connect/revoke`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${serviceClient}:${secret("test_integration_service_secret")}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          token: service.access_token,
          token_type_hint: "access_token",
        }),
      });
      expect(revoked.status).toBe(200);
      await expect(authenticate(service.access_token)).rejects.toMatchObject({
        status: 401,
      });
      if (process.env.RUN_INTEGRATION_HTTP_FIXTURE === "1") {
        const headers = { Authorization: `Bearer ${service.access_token}` };
        expect(
          (await fetch(`${origin}/api/v1/identity`, { headers })).status,
        ).toBe(401);
        expect(
          (await fetch(`${origin}/mcp`, { method: "POST", headers })).status,
        ).toBe(401);
      }
    } finally {
      callbackServer.close();
      await Promise.all([browser.close(), db.$client.end()]);
    }
  },
  30000,
);
