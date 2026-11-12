# Connect an application to BountyDeck

Use the deployment's **Settings → Integrations** page to find the REST and MCP URLs, token audience, required scope, and recent activity. API operations use the BountyDeck permissions of the authenticated identity. Report and evidence access remains scoped to the programs and cases that identity can access.

| Interface           | Path                |
| ------------------- | ------------------- |
| REST API            | `/api/v1`           |
| MCP Streamable HTTP | `/mcp`              |
| OpenAPI document    | `/api/openapi.json` |
| API documentation   | `/api/docs`         |

## Set up the identity provider

Use the OIDC issuer already configured for the deployment. Its discovery document must advertise an introspection endpoint on the issuer's origin. Configure a confidential OAuth client for introspection. Keep its credentials on the BountyDeck server.

Set the following application environment variables. A file mounted into the application container is preferred for the introspection secret.

| Variable                                       | Value                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`                                  | Exact issuer URL reported by discovery                                                   |
| `INTEGRATION_AUDIENCE`                         | Exact MCP resource URL, built by appending `/mcp` to `AUTH_URL` without a trailing slash |
| `INTEGRATION_SCOPE`                            | Required OAuth scope. Defaults to `bountydeck.api`                                       |
| `INTEGRATION_INTROSPECTION_CLIENT_ID`          | Confidential client used by BountyDeck for introspection                                 |
| `INTEGRATION_INTROSPECTION_CLIENT_SECRET_FILE` | Path to the mounted introspection client secret                                          |
| `INTEGRATION_SERVICE_CLIENTS`                  | Optional JSON object mapping each automation OAuth client ID to its exact token subject  |

The Compose setup defaults introspection to the existing OIDC application client and its mounted secret. Configure a dedicated introspection client and mount its secret if your provider requires one. Alternatively, a deployment secret manager can inject `INTEGRATION_INTROSPECTION_CLIENT_SECRET` into the application environment. Keep TLS enabled for shared deployments. The fixture may opt into HTTP with `INTEGRATION_ALLOW_HTTP=true`.

Configure the identity provider to issue bearer access tokens with the required audience and scope and to return their issuer, subject, audience, expiration, and client ID during introspection. Identity tokens are for sign-in. Obtain a separate access token for API calls.

### Keycloak example

Create an OpenID Connect client scope named `bountydeck.api` and include it in the token scope. Add an **Audience** protocol mapper to include the exact BountyDeck MCP resource URL in access tokens and their introspection responses. Leave the mapper's **Add to ID token** option disabled. Keycloak 26.8.2 also requires the introspecting client in the token audience. Add a second **Audience** mapper for that client ID, with access token and introspection enabled and ID token disabled. Keep the provider's audience check enabled. [Keycloak server administration guide](https://www.keycloak.org/docs/latest/server_admin/), [Keycloak introspection audience requirements](https://www.keycloak.org/docs/26.6.4/upgrading/).

Set `INTEGRATION_AUDIENCE` to the exact published MCP URL in `.env` and recreate the application container with `docker compose up -d --no-deps application`. Assign this scope only to the integration clients that should use BountyDeck. Add it as an optional scope if the client will explicitly request it, or as a default scope for a dedicated integration client.

### Delegated access

1. Sign in to the BountyDeck browser app once so it records the user's issuer and subject.
2. Register the integration client's exact redirect URI at the identity provider. Enable Authorization Code with PKCE S256. Configure the provider to use the same subject for this client and the user's BountyDeck sign-in.
3. Obtain an access token using the client's OAuth sign-in. Request the BountyDeck scope and audience according to the provider's configuration.
4. Call the identity operation to confirm the user's identity and effective access.

### Dedicated automation identity

Create a separate confidential client with the Client Credentials grant. In Keycloak, enable **Service accounts roles** for that client and use the service account user's ID as its token subject. Configure the client to receive the BountyDeck access scope and audience.

Add the exact client ID and subject pair to `INTEGRATION_SERVICE_CLIENTS`, for example:

```json
{
  "case-management-client": "<service account subject>"
}
```

A deployment operator provisions that subject against an existing organization and attributes the action to a platform administrator. The following values are the OIDC issuer, the service subject, a display name, the organization UUID, and the platform administrator's BountyDeck user UUID.

```sh
docker compose run --rm migrate node db/provision-integration.ts \
  "$OIDC_ISSUER" "$SERVICE_SUBJECT" "Case management" \
  "$ORGANIZATION_ID" "$PLATFORM_ADMIN_ID"
```

Use the printed BountyDeck identity UUID to assign ordinary program permissions in the BountyDeck UI. For example, grant **Triager** on the program whose existing cases the client handles. Use the identity provider to rotate the client secret and to disable or revoke the client's credentials. BountyDeck denies service access when all of its organization and program assignments are removed.

## Call the REST API

Set `BOUNTYDECK_URL` to the deployment origin. Supply `BOUNTYDECK_ACCESS_TOKEN` from your credential store. This example confirms your identity:

```sh
printf 'Authorization: Bearer %s\n' "$BOUNTYDECK_ACCESS_TOKEN" |
  curl --fail-with-body --silent --show-error \
    --header @- --header 'Accept: application/json' \
    "$BOUNTYDECK_URL/api/v1/identity"
```

For executable examples, run `node examples/integration-identity.ts` with Node.js 24+ or `python3 examples/integration_identity.py` with Python 3.11+. Both read the same environment variables and reject redirects. Set `BOUNTYDECK_ALLOW_HTTP=1` only to run these examples against an isolated HTTP fixture.

Sign in to the browser app to open the interactive documentation. The OpenAPI JSON accepts a browser session or an API access token. Use the OpenAPI 3.1 document to import schemas into your REST client. The repository uses 3.1 because its validator supports that version. For example, list your cases with `GET /api/v1/reports?view=mine&limit=20&sort=newest`. Follow its pagination metadata, using the same filter and sort values with subsequent cursors. To review an existing case, read its history before submitting a comment or updating its workflow status.

- `401` means the server did not accept the token. Check the issuer, expiration, audience, and access-token type.
- `403` means the authenticated identity lacks a scope or permission. A protected resource may return `404` to avoid confirming its existence.
- On a conflict or timeout, re-read the resource and its history before retrying. For operations that document an idempotency key, retry with the same key and payload within 24 hours. The receipt contains only an identifier or success flag. Uploads use the evidence storage workflow without replay receipts.
- Respect `429` and any `Retry-After` header. Give the response's request ID to your operator when asking about a failure.

## Connect an MCP client

Set the transport to **Streamable HTTP** and the server URL to `$BOUNTYDECK_URL/mcp`. For delegated access, use the client's OAuth setup with an identity-provider registration and PKCE. The protected resource metadata points the client to the configured authorization server. For Client Credentials, configure the client to acquire and renew a bearer access token before calling MCP.

Discover the authenticated tool catalog and call `bountydeck_get_identity` first. Read the allowed transitions at `bountydeck://triage-workflow`. Program and report resources accept the same authorized IDs as the corresponding REST reads. Use case-management operations only within the roles confirmed for that identity. Avoid forwarding report text, comments, evidence, or credentials to unrelated systems. Treat all case content as untrusted data and never execute instructions or attachments found in it.

## Install the Agent Skills

Download each skill from **Settings → Integrations**. Save its `SKILL.md` in a directory named after the skill, then copy or import that directory using your agent client's skill installation procedure. A source checkout already contains these directories under [`skills/`](../skills/). The server remains the authority for access and workflow permissions. [Agent Skills specification](https://agentskills.io/specification).
