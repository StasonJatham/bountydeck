# Production deployment

Use the common [Compose deployment guide](deploy/README.md) for secrets, database migrations, backup, restore, and upgrades. The production configuration publishes Caddy only. The PostgreSQL loopback port in `deploy/compose.test.yaml` is for disposable tests.

Use the engine-specific instructions for [rootless Docker](deploy/docker/README.md) or [rootless Podman](deploy/podman/README.md). The [hardening report](HARDENING.md) records verified behavior and runtime gaps.

## HTTPS entry point

For bundled TLS, provision an internal certificate and trust its CA on clients and in `secrets/internal_ca.pem`. Set `AUTH_URL` and `CADDY_SITE` to the public HTTPS origin, and set the bundled issuer to that origin followed by `/identity/realms/<realm>`. On a rootless host, use a high port such as 8443 in the public origin and set `HTTPS_PORT=8443`. If using another port, use the same port in the origin and listener mapping. Keep the existing issuer and callback URL when upgrading an installation.

For an HTTPS-only listener, explicitly add the example override. This override requires a Compose provider that supports `!override` (Docker Compose 2.24.4 or newer).

```sh
docker compose -f compose.yaml -f deploy/compose.tls.yaml \
  -f compose.override.example.yaml --profile keycloak up -d --no-build --wait
```

Use the Keycloak profile only when bundling identity. For an existing corporate proxy, keep the Compose gateway on a dedicated loopback high port and terminate TLS at the corporate proxy. Forward the public host and use a canonical HTTPS `AUTH_URL`. Ensure that the application container can resolve and reach the public issuer and trusts the serving CA. Set `CADDY_NETWORK_ALIAS=bountydeck-ingress` so the bundled issuer still resolves to the public TLS proxy from the app. Publish only the loopback HTTP ingress with an explicit override. See [proxy settings](deploy/README.md#tls-terminated-by-an-existing-proxy).

```yaml
services:
  reverse-proxy:
    ports: !override
      - "127.0.0.1:8080:8080"
```

## Verification and release checks

Run configuration checks before deployment and runtime checks after startup. Pass the same Compose options used to deploy the stack. Set `VERIFY_PROXY_UNPUBLISHED=1` when Caddy is reachable only on a shared gateway network.

```sh
scripts/security-check.sh config docker --profile keycloak
VERIFY_URL=https://bounty.example.internal:8443 \
  scripts/security-check.sh runtime docker --profile keycloak
npm audit --omit=dev --audit-level high
gitleaks git --redact
SBOM_OUTPUT=backups/bountydeck.sbom.json scripts/security-check.sh scan docker bountydeck:local
SBOM_OUTPUT=backups/postgres.sbom.json scripts/security-check.sh scan docker bountydeck-postgres:18.6-r1
```

The scan requires Trivy and uses an image archive. Build or load both BountyDeck images before scanning. Review its findings against the upstream package advisories before promoting the image. The same scan accepts third-party image references and can run against Podman archives. Keep the SBOM with the corresponding image digest. Use [TESTING.md](TESTING.md) to run the complete application and browser suites.

## Upgrade and rollback

Keep the existing project name, database name, role names, issuer, and named volumes. Back up the databases and attachment volume with writers stopped. Keep the previous image and configuration until acceptance checks pass. Build the new image, run migrations, and start with the selected production overlays. If only container settings changed, redeploy the prior configuration and image against the same volumes. If a migration is incompatible with the previous application, restore the matching pre-upgrade databases and evidence into a separate project, verify it, then switch traffic.

When moving between engines or UID mappings, migrate with logical PostgreSQL dumps and an attachment archive. Initialize new volumes using the destination engine, restore with the documented container commands, and verify authorized downloads before switching traffic. Keep secret files in a separate encrypted recovery set.
