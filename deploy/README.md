# Deployment

Use Docker Engine with Docker Compose v2 or later. The Compose stack uses separate PostgreSQL login roles for migrations, request handling, the worker and optional Keycloak. Only Caddy publishes ports. Container references are pinned to version and manifest digest. Protect the host, Docker access and backup storage.

PostgreSQL is built from the pinned upstream Alpine image in `deploy/postgres/Dockerfile`. The build installs exact Alpine security package versions and keeps PostgreSQL 18.6 and its existing volume layout. Build the `postgres` service before upgrading an existing checkout. Compose uses the locally built image and never automatically pulls that tag. To use a prebuilt image, load it or pull its immutable registry reference explicitly and set `BOUNTYDECK_POSTGRES_IMAGE`.

## Local Keycloak example

Resolve `bountydeck.test` to `127.0.0.1` on the browser host, for example by adding `127.0.0.1 bountydeck.test` to its hosts file. Caddy uses the same hostname on the Compose network, so discovery, callbacks and redirects use a single issuer. The supplied HTTP configuration is for loopback development. Keep `BIND_ADDRESS=127.0.0.1` for this example.

```sh
cp .env.example .env
./deploy/init-secrets.sh keycloak
docker compose --profile keycloak pull reverse-proxy keycloak
docker compose --profile keycloak build application postgres
docker compose run --rm migrate
docker compose --profile keycloak up -d --no-build --wait
```

Check the app at `http://bountydeck.test` and the identity console at `http://bountydeck.test/identity/admin/`. For an existing loopback HTTP fixture, set `CADDY_IDENTITY_ADMIN_ENABLED=true` to enable the console. The initial Keycloak console account is `bountydeck-bootstrap`. Retrieve its randomly generated password from `secrets/keycloak_admin_password`. In the **bountydeck** realm, create a user, set their credentials and record their ID from the user details page. That ID is the OIDC subject for the bundled client. Sign in once with the realm user so BountyDeck records the identity. Set the shell variable `subject` to that user ID. Grant platform administration from the migration container:

```sh
docker compose run --rm migrate node db/grant-admin.ts \
  oidc:http://bountydeck.test/identity/realms/bountydeck "$subject"
```

Give Keycloak administrators individual accounts and remove the temporary Keycloak console account.

The Keycloak database is created only when PostgreSQL initializes an empty volume and the Keycloak database password exists. To enable Keycloak on an existing stack, generate its secrets first, recreate the PostgreSQL container to mount the new secret file, then provision its separate login and database through the PostgreSQL administrator before starting the profile. Recreating a container keeps its named volume.

## Disposable test fixtures

Run this only with an empty local Compose application database. Start the local Keycloak example using the test override so the host test runner can reach PostgreSQL at loopback port 55432. Use this override only for a disposable test project. PostgreSQL has no host port in the base stack. When finished, remove the override by recreating PostgreSQL with the base Compose file for that same project.

```sh
docker compose -f compose.yaml -f deploy/compose.test.yaml --profile keycloak up -d --no-build --wait
./deploy/provision-test-identity.sh
BOUNTYDECK_DEMO_FIXTURES=1 \
  DEMO_DATABASE_URL="postgresql://postgres:$(cat secrets/db_admin_password)@127.0.0.1:55432/bountydeck" \
  OIDC_ISSUER=http://bountydeck.test/identity/realms/bountydeck npm run seed-demo
```

The fixture usernames are `local-platform-admin`, `local-manager`, `local-triager`, `local-researcher`, and `local-outsider`. Their randomly generated password lives in `secrets/test_user_password`. The regular realm import has no fixture users.

## Private TLS deployment

1. Allocate a DNS name such as `bounty.example.internal`. Point clients at the deployment host.
2. Set `APP_HOSTNAME=bounty.example.internal`, `AUTH_URL=https://bounty.example.internal`, `CADDY_SITE=https://bounty.example.internal`, and `BIND_ADDRESS` to the intended host interface. For the bundled Keycloak set `OIDC_ISSUER=https://bounty.example.internal/identity/realms/bountydeck`, `KEYCLOAK_SSL_REQUIRED=all`, and `CADDY_IDENTITY_ADMIN_ENABLED=false`.
3. Place the certificate chain and key issued by your internal CA at `secrets/tls_cert.pem` and `secrets/tls_key.pem`. Set those files to mode `0444` for the container bind mounts and keep the enclosing `secrets/` directory at `0700` on the host. Install the CA on clients. Add the CA chain to `secrets/internal_ca.pem` so Node can verify HTTPS connections to the issuer and private notification servers.
4. Run the installation commands above with `docker compose -f compose.yaml -f deploy/compose.tls.yaml`. Recreate the affected containers after replacing a bind-mounted secret file. TLS uses the provisioned certificate and does not require a public ACME server.

### High ports for rootless engines

Set the published ports above the host's unprivileged port threshold. Compose uses matching host and container ports so bundled OIDC can use the same issuer inside and outside the stack. Keep `APP_HOSTNAME` as a hostname without a port.

| Setting                            | Default       | Local HTTP example                                       | Private TLS example                                       |
| ---------------------------------- | ------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `HTTP_PORT`                        | `80`          | `8080`                                                   | `8080`                                                    |
| `HTTPS_PORT`                       | `443`         | `8443`                                                   | `8443`                                                    |
| `AUTH_URL` and `CADDY_SITE`        | Set in `.env` | `http://bountydeck.test:8080`                            | `https://bountydeck.test:8443`                            |
| `OIDC_ISSUER` for bundled Keycloak | Set in `.env` | `http://bountydeck.test:8080/identity/realms/bountydeck` | `https://bountydeck.test:8443/identity/realms/bountydeck` |

Update an external OIDC client's redirect URI when the public origin changes.

### TLS terminated by an existing proxy

Keep BountyDeck's Caddy as the private router for the application and optional Keycloak. For a host-based proxy, forward the entire site to `http://127.0.0.1:8080` and preserve the public Host. Use these values with the base Compose file:

```dotenv
APP_HOSTNAME=bounty.example.internal
AUTH_URL=https://bounty.example.internal
CADDY_SITE=http://bounty.example.internal:8080
CADDY_NETWORK_ALIAS=bountydeck-ingress
HTTP_PORT=8080
HTTPS_PORT=8443
BIND_ADDRESS=127.0.0.1
OIDC_ISSUER=https://bounty.example.internal/identity/realms/bountydeck
KEYCLOAK_SSL_REQUIRED=all
CADDY_IDENTITY_ADMIN_ENABLED=false
```

For a containerized gateway, put the gateway and BountyDeck's Caddy on a shared Docker network and forward to `http://bountydeck-ingress:8080`. Add only Caddy to the gateway network with an override like this:

```yaml
services:
  reverse-proxy:
    networks:
      gateway:
        aliases: [bountydeck-ingress]
networks:
  gateway:
    external: true
    name: internal_gateway
```

The public hostname must resolve to the external TLS proxy from the application container. The distinct internal alias preserves that DNS route. For a private TLS certificate, put its issuing CA in `secrets/internal_ca.pem`. The Keycloak admin and master realm routes are blocked at TLS ingress. Use `/opt/keycloak/bin/kcadm.sh` from an authorized shell inside the Keycloak container for production administration.

## Runtime limits

| Service     | Override prefix        | CPUs |  Memory | PID limit | Open files |
| ----------- | ---------------------- | ---: | ------: | --------: | ---------: |
| Application | `BOUNTYDECK_APP`       |    2 |   1 GiB |       256 |      8,192 |
| Worker      | `BOUNTYDECK_WORKER`    |    1 | 512 MiB |       128 |      4,096 |
| PostgreSQL  | `BOUNTYDECK_POSTGRES`  |    2 |   1 GiB |       256 |      8,192 |
| Keycloak    | `BOUNTYDECK_KEYCLOAK`  |    2 | 1.5 GiB |       512 |      8,192 |
| Caddy       | `BOUNTYDECK_CADDY`     |    1 | 256 MiB |       128 |      8,192 |
| Migration   | `BOUNTYDECK_MIGRATE`   |    1 | 512 MiB |       128 |      4,096 |
| Retention   | `BOUNTYDECK_RETENTION` |    1 | 512 MiB |       128 |      4,096 |

Append `_CPUS`, `_MEMORY`, `_PIDS` or `_NOFILE` to a prefix and set the resulting variable in `.env`. For example, `BOUNTYDECK_APP_MEMORY=2g` doubles the application's memory limit. The PID limits include threads. PostgreSQL defaults to 100 connections, adjustable with `BOUNTYDECK_POSTGRES_MAX_CONNECTIONS`. Tune connection count, PID limits and memory together. Keycloak uses the upstream container-aware JVM heap settings. Leave memory headroom for JVM native allocations and startup augmentation. Logs use the Docker `json-file` driver with a 10 MiB rotation threshold and three files per service, configurable via `BOUNTYDECK_LOG_MAX_SIZE` and `BOUNTYDECK_LOG_MAX_FILES`.

Application and maintenance containers run as the unprivileged Node user with read-only roots. The application uses a temporary Next.js image cache and the private evidence volume. Caddy writes certificate data and configuration state to named volumes. PostgreSQL writes to its data volume and temporary socket directory. Keycloak's upstream startup needs a writable distribution to import and configure the realm. The internal identity network joins only Caddy and Keycloak. The separate internal PostgreSQL network is shared by the database clients. Keep untrusted workloads off both networks.

## External OIDC

Initialize secrets with `./deploy/init-secrets.sh` and leave the `keycloak` profile disabled. Configure an existing identity provider for a confidential OpenID Connect web client using Authorization Code Flow with PKCE S256. Register the exact `https://<app-host>/api/auth/callback/oidc` redirect URI. Set its discovery issuer in `OIDC_ISSUER`, its client ID in `OIDC_CLIENT_ID` and its client secret in `secrets/oidc_client_secret`. When granting platform administration, pass `oidc:<issuer>` as the provider and use the subject issued to this client. Put any private issuer CA chain in `secrets/internal_ca.pem`. The Keycloak profile can stay disabled. The external issuer must be reachable from the application container.

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
docker compose exec -T postgres pg_dump -U postgres -Fc bountydeck > backups/bountydeck.dump
# Run only if Keycloak is enabled.
docker compose exec -T postgres pg_dump -U postgres -Fc keycloak > backups/keycloak.dump
docker compose run --rm --no-deps --entrypoint tar application \
  -C /var/lib/bountydeck/attachments -cf - . > backups/attachments.tar
docker compose --profile keycloak up -d --no-build --wait
```

Keep the versioned deployment files and `.env` in protected recovery storage. Back up secret files separately in an encrypted set. The bundled realm retains its imported OIDC client secret in its database, so restore the matching `oidc_client_secret`. Secure backups as confidential report evidence. If Keycloak is disabled, omit its dump and profile from these commands.

Restore into a fresh stack or a separate Compose project with unused ports. Initialize PostgreSQL using the matching secret files and original role names. Keep other services stopped. The databases must be empty, so skip migrations until after the restores.

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U postgres --exit-on-error --single-transaction \
  -d bountydeck < backups/bountydeck.dump
# Run only if Keycloak is enabled.
docker compose exec -T postgres pg_restore -U postgres --exit-on-error --single-transaction \
  -d keycloak < backups/keycloak.dump
docker compose run --rm -T --no-deps --entrypoint tar application \
  -C /var/lib/bountydeck/attachments -xf - < backups/attachments.tar
docker compose run --rm migrate
docker compose --profile keycloak up -d --no-build --wait
```

After restoring, verify discovery and sign-in, open an authorized report and download an attachment. Check that a user from another unit cannot open it.

## Upgrade and offline operation

Back up the running version and retain its images. Build the replacement images with `docker compose build application postgres`, stop the app and worker, run the new migration service and start the new services. Review PostgreSQL and Keycloak upgrade requirements before changing their major versions. Roll back using the matching pre-upgrade backup if the schema upgrade cannot be reversed.

Build the application and pull the pinned service images on a connected machine using the deployment architecture. Transfer them through an internal registry or `docker image save` and `docker image load`. When relying on archives, confirm that the target engine can resolve each digest-qualified Compose reference, or adjust the target references to the exact locally imported image tags and verify the image IDs. Start with `--no-build --pull never`. Run migrations with `docker compose run --pull never --rm migrate`. Provide local DNS, identity, certificates and any configured notification destinations. Avoid public ACME and use the TLS overlay for disconnected installations.

## Language

BountyDeck offers English and German in its language selector. The bundled realm enables both languages for new installations. For an existing Keycloak realm, enable internationalization under Realm settings and add English and German as supported locales. BountyDeck passes the chosen language to the identity provider during sign-in.

## Upgrade an installation created before the naming update

Keep the existing hostname, OIDC issuer, and client ID in your `.env`. The issuer is part of each account's identity. Keep your existing Compose project name and database so Compose continues using the same volumes. If your installation used the original defaults, add these settings before rebuilding:

```dotenv
COMPOSE_PROJECT_NAME=bossob
BOUNTYDECK_DATABASE=bossob
KEYCLOAK_REALM=bossob
KEYCLOAK_BOOTSTRAP_USER=bossob-bootstrap
```

If you used a different project or database name, substitute the values from your installation. Rename the optional `BOSSOB_IMAGE` override to `BOUNTYDECK_IMAGE`. For database backups and restores, use your configured database name. The named attachment volume mounts at `/var/lib/bountydeck/attachments`.

Existing PostgreSQL role names are retained for migration compatibility. Webhooks send the documented `X-BountyDeck-*` headers and the previous header names so existing receivers can migrate at their own pace.

## Researcher achievements

The achievement migration reconciles existing validated reports and points. To rerun reconciliation after importing historical data, pass the user ID of an existing platform administrator.

```sh
docker compose run --rm --no-deps application node db/reconcile-achievements.ts <platform-admin-uuid>
```

Platform administrators can finalize completed UTC quarters and years through **Administration**. Finalization stores the standings and grants any earned competitive badges. Equal point totals share a rank. Later corrections do not change a finalized season.
