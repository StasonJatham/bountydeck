import { readFileSync } from "node:fs";
import { z } from "zod";

const identity = z.object({
  id: z.string().min(1).max(255),
  username: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  enabled: z.boolean(),
  requiredActions: z.array(z.string()).optional(),
});

export function keycloakAdminEnabled() {
  return Boolean(
    process.env.KEYCLOAK_ADMIN_ISSUER &&
    process.env.KEYCLOAK_ADMIN_CLIENT_ID &&
    (process.env.KEYCLOAK_ADMIN_CLIENT_SECRET_FILE ||
      process.env.KEYCLOAK_ADMIN_CLIENT_SECRET) &&
    process.env.KEYCLOAK_ADMIN_USER_GROUP,
  );
}

export async function keycloakAdmin() {
  if (!keycloakAdminEnabled())
    throw new Error("Identity management unavailable");
  const issuer = new URL(process.env.KEYCLOAK_ADMIN_ISSUER!);
  const external = new URL(process.env.OIDC_ISSUER!);
  const match = /^(.*)\/realms\/([^/]+)\/?$/.exec(issuer.pathname);
  if (
    !match ||
    (issuer.protocol !== "https:" &&
      !(
        issuer.protocol === "http:" &&
        process.env.KEYCLOAK_ADMIN_ALLOW_HTTP === "true"
      )) ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    !external.pathname.replace(/\/$/, "").endsWith("/realms/" + match[2]) ||
    decodeURIComponent(match[2]) === "master"
  )
    throw new Error("Invalid identity management configuration");
  const path = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET_FILE;
  const secret = path
    ? readFileSync(path, "utf8").trim()
    : process.env.KEYCLOAK_ADMIN_CLIENT_SECRET!;
  const request = (url: string, options: RequestInit) =>
    fetch(url, {
      ...options,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  const response = await request(
    issuer.href.replace(/\/$/, "") + "/protocol/openid-connect/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID!,
        client_secret: secret,
      }),
    },
  );
  if (!response.ok)
    throw new Error("Identity management authentication failed");
  const { access_token: token } = z
    .object({ access_token: z.string().min(1) })
    .parse(await response.json());
  const base = issuer.origin + match[1] + "/admin/realms/" + match[2];
  async function api(path: string, method = "GET", body?: unknown) {
    const result = await request(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!result.ok) throw new Error("Identity management request failed");
    return result;
  }
  const groupPath = process.env.KEYCLOAK_ADMIN_USER_GROUP!;
  if (!/^\/[A-Za-z0-9_-]{1,80}$/.test(groupPath))
    throw new Error("Invalid managed user group");
  const { id: groupId } = z
    .object({ id: z.string().min(1) })
    .parse(
      await (
        await api(
          "/group-by-path/" + encodeURIComponent(groupPath.replace(/^\//, "")),
        )
      ).json(),
    );
  const members = "/groups/" + encodeURIComponent(groupId) + "/members";
  return {
    async list(first = 0) {
      return z
        .array(identity)
        .parse(await (await api(members + "?max=100&first=" + first)).json());
    },
    async target(id: string) {
      const target = "/users/" + encodeURIComponent(id);
      const groups = z
        .array(z.object({ id: z.string() }))
        .parse(await (await api(target + "/groups?max=1000")).json());
      if (!groups.some((group) => group.id === groupId))
        throw new Error("Identity outside managed group");
      return {
        async get() {
          return identity.parse(await (await api(target)).json());
        },
        update: (value: Record<string, unknown>) => api(target, "PUT", value),
        reset: (value: string) =>
          api(target + "/reset-password", "PUT", {
            type: "password",
            value,
            temporary: true,
          }),
        logout: () => api(target + "/logout", "POST"),
        remove: () => api(target, "DELETE"),
      };
    },
    async create(details: {
      username: string;
      email: string;
      firstName: string;
      lastName: string;
      password: string;
    }) {
      const { password, ...profile } = details;
      return api("/users", "POST", {
        ...profile,
        enabled: true,
        groups: [groupPath],
        requiredActions: ["UPDATE_PASSWORD"],
        credentials: [{ type: "password", value: password, temporary: true }],
      });
    },
  };
}
