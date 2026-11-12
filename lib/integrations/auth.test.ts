import { describe, expect, it } from "vitest";
import { authenticateIntegration, validateIntrospection } from "./auth";

const config = {
  issuer: "https://issuer.example.test",
  audience: "https://bounty.example.test",
  scope: "bountydeck.api",
  services: { triage: "service-subject" },
};
const now = 1_700_000_000;
const delegated = {
  active: true,
  iss: config.issuer,
  sub: "human-subject",
  aud: ["account", config.audience],
  exp: now + 60,
  client_id: "desktop",
  scope: "openid bountydeck.api",
  typ: "Bearer",
};

describe("integration access tokens", () => {
  it("rejects missing and non-Bearer credentials", async () => {
    for (const authorization of [
      "",
      "Basic credentials",
      "Bearer x, Bearer y",
    ]) {
      await expect(
        authenticateIntegration(
          new Request(config.audience, { headers: { authorization } }),
        ),
      ).rejects.toMatchObject({ status: 401, code: "invalid_token" });
    }
  });

  it("checks issuer, audience, activity, expiration, token type, and scope", () => {
    for (const claims of [
      { active: false },
      { iss: "https://other.example.test" },
      { aud: "different-service" },
      { exp: now },
      { nbf: now + 1 },
      { typ: "ID", token_type: "Bearer" },
      { typ: undefined },
      { token_use: "id" },
      { cnf: { jkt: "example" } },
      { azp: "mismatched" },
    ]) {
      expect(() =>
        validateIntrospection({ ...delegated, ...claims }, config, now),
      ).toThrow(expect.objectContaining({ status: 401 }));
    }
    expect(() =>
      validateIntrospection(
        { ...delegated, scope: "openid other" },
        config,
        now,
      ),
    ).toThrow(
      expect.objectContaining({ status: 403, code: "insufficient_scope" }),
    );
  });

  it("requires a service binding and attributes delegated users separately", () => {
    expect(validateIntrospection(delegated, config, now)).toEqual({
      actorType: "delegated",
      clientId: "desktop",
      subject: "human-subject",
    });
    const service = {
      ...delegated,
      grant_type: "client_credentials",
      client_id: "triage",
    };
    expect(
      validateIntrospection(
        { ...service, sub: "service-subject" },
        config,
        now,
      ),
    ).toEqual({
      actorType: "service",
      clientId: "triage",
      subject: "service-subject",
    });
    for (const claims of [
      service,
      { ...service, client_id: "unprovisioned" },
    ]) {
      expect(() => validateIntrospection(claims, config, now)).toThrow(
        expect.objectContaining({ status: 403, code: "identity_unavailable" }),
      );
    }
  });
});
