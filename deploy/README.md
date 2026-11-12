# Deployment

Use Docker Engine with Docker Compose v2 or later. The Compose stack uses separate PostgreSQL login roles for migrations, request handling, the worker and optional Keycloak. Only Caddy publishes ports. Container references are pinned to version and manifest digest. Protect the host, Docker access and backup storage.

## Local Keycloak example

Resolve `bossob.test` to `127.0.0.1` on the browser host, for example by adding `127.0.0.1 bossob.test` to its hosts file. Caddy uses the same hostname on the Compose network, so discovery, callbacks and redirects use a single issuer. The supplied HTTP configuration is for loopback development. Keep `BIND_ADDRESS=127.0.0.1` for this example.

```sh
cp .env.example .env
./deploy/init-secrets.sh keycloak
docker compose --profile keycloak pull postgres reverse-proxy keycloak
docker compose --profile keycloak build application
docker compose run --rm migrate
docker compose --profile keycloak up -d --no-build --wait
```

Check the app at `http://bossob.test` and the identity console at `http://bossob.test/identity/admin/`. The initial Keycloak console account is `bossob-bootstrap`. Retrieve its randomly generated password from `secrets/keycloak_admin_password`. In the **bossob** realm, create a user, set their credentials and record their ID from the user details page. That ID is the OIDC subject for the bundled client. Sign in once with the realm user so BountyDeck records the identity. Set the shell variable `subject` to that user ID. Grant platform administration from the migration container:

```sh
docker compose run --rm migrate node db/grant-admin.ts \
  oidc:http://bossob.test/identity/realms/bossob "$subject"
```

Give Keycloak administrators individual accounts and remove the temporary Keycloak console account.

The Keycloak database is created only when PostgreSQL initializes an empty volume and the Keycloak database password exists. To enable Keycloak on an existing stack, generate its secrets first, recreate the PostgreSQL container to mount the new secret file, then provision its separate login and database through the PostgreSQL administrator before starting the profile. Recreating a container keeps its named volume.

## Disposable test fixtures

Run this only with an empty local Compose application database. Start the local Keycloak example using the test override so the host test runner can reach PostgreSQL at loopback port 55432. On an already-running local stack, the first command adds that loopback mapping.

```sh
docker compose -f compose.yaml -f deploy/compose.test.yaml --profile keycloak up -d --no-build --wait
./deploy/provision-test-identity.sh
BOSSOB_DEMO_FIXTURES=1 \
  DEMO_DATABASE_URL="postgresql://postgres:$(cat secrets/db_admin_password)@127.0.0.1:55432/bossob" \
  OIDC_ISSUER=http://bossob.test/identity/realms/bossob npm run seed-demo
```

The fixture usernames are `local-platform-admin`, `local-manager`, `local-triager`, `local-researcher`, and `local-outsider`. Their randomly generated password lives in `secrets/test_user_password`. The regular realm import has no fixture users.

## Private TLS deployment

1. Allocate a DNS name such as `bounty.example.internal`. Point clients at the deployment host.
2. Set `APP_HOSTNAME=bounty.example.internal`, `AUTH_URL=https://bounty.example.internal`, `CADDY_SITE=https://bounty.example.internal`, and `BIND_ADDRESS` to the intended host interface. For the bundled Keycloak set `OIDC_ISSUER=https://bounty.example.internal/identity/realms/bossob` and `KEYCLOAK_SSL_REQUIRED=all`.
3. Place the certificate chain and key issued by your internal CA at `secrets/tls_cert.pem` and `secrets/tls_key.pem`. Make them readable by the Caddy container and keep the enclosing host directory private. Install the CA on clients. Add the CA chain to `secrets/internal_ca.pem` so Node can verify HTTPS connections to the issuer and private notification servers.
4. Run the installation commands above with `docker compose -f compose.yaml -f deploy/compose.tls.yaml`. Recreate the affected containers after replacing a bind-mounted secret file. TLS uses the provisioned certificate and does not require a public ACME server.

With an existing reverse proxy, forward requests to the application through a private network, preserve the original Host, set `X-Forwarded-Proto: https` and overwrite client-supplied forwarding headers. Do not publish the application directly. Set `AUTH_URL` to the public HTTPS origin. If Keycloak is in use, forward `/identity/` to that service, configure the issuer using the public HTTPS origin, and make that origin reachable from the application with a trusted certificate. Keep administrative identity endpoints restricted to authorized operators.

## External OIDC

Initialize secrets with `./deploy/init-secrets.sh` and leave the `keycloak` profile disabled. Configure an existing identity provider for a confidential OpenID Connect web client using Authorization Code Flow with PKCE S256. Register the exact `https://<app-host>/api/auth/callback/oidc` redirect URI. Set its discovery issuer in `OIDC_ISSUER`, its client ID in `OIDC_CLIENT_ID` and its client secret in `secrets/oidc_client_secret`. When granting platform administration, pass `oidc:<issuer>` as the provider and use the subject issued to this client. Put any private issuer CA chain in `secrets/internal_ca.pem`. Remove the Keycloak proxy route from the Caddyfile for this configuration.

## Evidence

`ATTACHMENT_TYPES` restricts which supported evidence formats can be uploaded. The default accepts PNG and plain text. Set it to a comma-separated subset of `image/png,text/plain` with no spaces. Files are stored in the private `attachments` volume.

Optionally set `ATTACHMENT_SCANNER` to an absolute path to a trusted scanner executable in the application image. BountyDeck gives it one argument, the private evidence path. A zero exit status accepts the file. Other exits, startup failures, and timeouts reject the upload. Supply the scanner and its signatures through your internal image or a local mount. Set `REPORT_EXPORTS_ENABLED=false` to disable JSON report downloads deployment-wide. Evidence downloads continue to require report access.

## Report retention

Use your organization’s approved retention period. Stop the application and worker for the maintenance window and make an encrypted database and evidence backup. Choose the organization UUID and the user UUID of a platform administrator for audit attribution. Run a dry run first, then use `--apply` to redact eligible closed reports.

```sh
docker compose run --rm retention node deploy/retention.ts "$org" 365 "$actor"
docker compose run --rm retention node deploy/retention.ts "$org" 365 "$actor" --apply
```

Retention removes report text, discussions, CVSS vectors, and evidence. It keeps the report identifier, workflow metadata, audit history, and score ledger. Pending evidence deletions remain queued if storage is unavailable. Re-run the apply command after correcting storage permissions. Rotate confidential backups and exported copies under the same organizational policy.

## Notifications

Set `SMTP_FROM` and save the authenticated relay URL in `secrets/smtp_url`. Use TLS. For an isolated integration relay, `SMTP_ALLOW_PLAINTEXT=true` opts out of the TLS requirement.

Configure `WEBHOOK_DESTINATIONS` as a JSON object mapping an exact HTTPS origin to every approved DNS address for that origin. For example, `WEBHOOK_DESTINATIONS='{"https://hooks.example.internal":["10.10.10.5"]}'`. A DNS result outside the configured address set causes delivery to fail. Restrict the worker's network egress to PostgreSQL, DNS, the approved SMTP relay and webhook destinations. Limit access to the protected secret directory. Service containers receive only the secret files they need.

## Backup and restore

Before snapshotting, stop the services that write to PostgreSQL or attachment storage. Include `--profile keycloak` when using bundled identity. Run the same Compose overlays that you use for the deployed stack.

```sh
umask 077
mkdir -p backups
docker compose stop application worker
# Also stop Keycloak if enabled.
docker compose --profile keycloak stop keycloak
docker compose exec -T postgres pg_dump -U postgres -Fc bossob > backups/bossob.dump
# Run only if Keycloak is enabled.
docker compose exec -T postgres pg_dump -U postgres -Fc keycloak > backups/keycloak.dump
docker compose run --rm --no-deps --entrypoint tar application \
  -C /var/lib/bossob/attachments -cf - . > backups/attachments.tar
docker compose --profile keycloak up -d --no-build --wait
```

Keep the versioned deployment files, `.env` and secret files with an encrypted backup set. The bundled realm retains its imported OIDC client secret in its database, so restore the matching `oidc_client_secret`. Secure backups as confidential report evidence. If Keycloak is disabled, omit its dump and profile from these commands.

Restore into a fresh stack or a separate Compose project with unused ports. Initialize PostgreSQL using the matching secret files and original role names. Keep other services stopped. The databases must be empty, so skip migrations until after the restores.

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U postgres --exit-on-error --single-transaction \
  -d bossob < backups/bossob.dump
# Run only if Keycloak is enabled.
docker compose exec -T postgres pg_restore -U postgres --exit-on-error --single-transaction \
  -d keycloak < backups/keycloak.dump
docker compose run --rm -T --no-deps --entrypoint tar application \
  -C /var/lib/bossob/attachments -xf - < backups/attachments.tar
docker compose run --rm migrate
docker compose --profile keycloak up -d --no-build --wait
```

After restoring, verify discovery and sign-in, open an authorized report and download an attachment. Check that a user from another unit cannot open it.

## Upgrade and offline operation

Back up the running version and retain its images. Build the replacement from the locked dependencies, stop the app and worker, run the new migration service and start the new services. Review PostgreSQL and Keycloak upgrade requirements before changing their major versions. Roll back using the matching pre-upgrade backup if the schema upgrade cannot be reversed.

Build the application and pull the pinned service images on a connected machine using the deployment architecture. Transfer them through an internal registry or `docker image save` and `docker image load`. When relying on archives, confirm that the target engine can resolve each digest-qualified Compose reference, or adjust the target references to the exact locally imported image tags and verify the image IDs. Start with `--no-build --pull never`. Run migrations with `docker compose run --pull never --rm migrate`. Provide local DNS, identity, certificates and any configured notification destinations. Avoid public ACME and use the TLS overlay for disconnected installations.

## Language

BountyDeck offers English and German in its language selector. The bundled realm enables both languages for new installations. For an existing Keycloak realm, enable internationalization under Realm settings and add English and German as supported locales. BountyDeck passes the chosen language to the identity provider during sign-in.
