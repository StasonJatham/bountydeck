import { afterEach, expect, it, vi } from "vitest";
import { keycloakAdmin } from "./keycloak-admin";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("scopes credential and session management to the configured group", async () => {
  vi.stubEnv(
    "KEYCLOAK_ADMIN_ISSUER",
    "https://internal.test/identity/realms/example",
  );
  vi.stubEnv("OIDC_ISSUER", "https://external.test/identity/realms/example");
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_ID", "users");
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET", "test-only");
  vi.stubEnv("KEYCLOAK_ADMIN_CLIENT_SECRET_FILE", "");
  vi.stubEnv("KEYCLOAK_ADMIN_USER_GROUP", "/managed");
  const request = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith("/token"))
      return Response.json({ access_token: "fixture" });
    expect(options.redirect).toBe("error");
    expect(new Headers(options.headers).get("authorization")).toBe(
      "Bearer fixture",
    );
    if (url.endsWith("/group-by-path/managed"))
      return Response.json({ id: "managed" });
    if (url.includes("/users/outside/groups"))
      return Response.json([{ id: "other" }]);
    if (url.includes("/users/inside/groups"))
      return Response.json([{ id: "managed" }]);
    if (url.endsWith("/users/inside/reset-password")) {
      expect(JSON.parse(String(options.body))).toEqual({
        type: "password",
        value: "new-password",
        temporary: true,
      });
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected test request");
  });
  vi.stubGlobal("fetch", request);
  const admin = await keycloakAdmin();
  await expect(admin.target("outside")).rejects.toThrow(
    "outside managed group",
  );
  await expect(
    (await admin.target("inside")).reset("new-password"),
  ).resolves.toHaveProperty("status", 204);
});
