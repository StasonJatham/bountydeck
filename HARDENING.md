# Deployment hardening

## Baseline

The existing local Docker Desktop stack on the pre-hardening revision `904b440` reports healthy application and Keycloak containers. The public loopback entry point returned `{"status":"ok"}`, Keycloak discovery returned the expected `http://bossob.test/identity/realms/bossob` issuer, and PostgreSQL reported 14 applied migrations. Docker Engine 29.9.2 and Compose v5.6.1 were available. The daemon did not report rootless mode. Podman was not installed.

The preceding acceptance run at this revision passed 31 Vitest and 8 Chromium tests with zero skips, using a separately migrated Docker PostgreSQL and Keycloak fixture. It covered OIDC, REST, MCP, evidence, report transitions, tenant isolation, scoring, and SMTP and HTTPS notification retries. The existing local deployment is preserved during hardening.

| Service | Baseline user | Network | Host ports | Writable state |
| --- | --- | --- | --- | --- |
| Next.js | node | web, database | none | attachments, writable root |
| Worker | node | worker, database | none | writable root |
| Migration and retention | node | database | none | writable root, retention attachment volume |
| PostgreSQL | upstream root entrypoint then postgres | database | none | PostgreSQL volume, socket directory, writable root |
| Keycloak | 1000 | web, database | none | database and writable distribution for build-on-start |
| Caddy | upstream root | web | loopback 80 and 443 | certificate data, config and writable root |

The fixture notification receiver joins its own test network. Production database traffic is on an internal Docker network. Keycloak and the application share the edge network with Caddy for OIDC discovery. Existing services already used no-new-privileges. The running containers had writable roots and no explicit memory limits. The image references were pinned, and role credentials were file-backed beneath the deployment user's private secret directory.

## Hardened runtime

All services use no-new-privileges and the engine's default seccomp policy. Only Caddy publishes ports. The HTTPS-only override publishes a single explicitly selected port. Application and worker files are owned by root inside the image, and the runtime runs as numeric 1000:1000. The final runtime excludes npm, npx, and setuid/setgid permissions on system binaries. It keeps the shell and archive tools used by startup, backup and restore.

| Service | Runtime UID | Capabilities | Root filesystem and writable mounts | Networks | Defaults (CPU / memory / PIDs / files) | Health |
| --- | --- | --- | --- | --- | --- | --- |
| Application | 1000 | None | Read-only, attachments volume, bounded tmpfs for temporary files and Next cache | web, database | 2 / 1 GiB / 256 / 8192 | HTTP readiness including PostgreSQL |
| Worker | 1000 | None | Read-only, bounded temporary tmpfs | worker, database | 1 / 512 MiB / 128 / 4096 | Container state, delivery covered by smoke tests |
| Migration | 1000 | None | Read-only, bounded temporary tmpfs | database | 1 / 512 MiB / 128 / 4096 | One-shot exit status |
| Retention | 1000 | None | Read-only, attachments volume, bounded temporary tmpfs | database | 1 / 512 MiB / 128 / 4096 | One-shot exit status |
| PostgreSQL | Upstream initializer then postgres (70) | Initializer CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID. The database process has zero effective capabilities after initialization. | Read-only, data volume, socket and temporary tmpfs | database | 2 / 1 GiB / 256 / 8192 | pg_isready |
| Keycloak | 1000 | None | Writable upstream distribution for production build-on-start, read-only realm/config binds | identity, database | 2 / 1.5 GiB / 512 / 8192 | Loopback management readiness |
| Caddy | Upstream UID 0 | NET_BIND_SERVICE for legacy low listeners | Read-only, private data and config volumes, read-only configuration | web, identity | 1 / 256 MiB / 128 / 8192 | Container state plus external readiness check |

The database and identity networks are internal. Caddy cannot connect directly to PostgreSQL. The application, worker, and Keycloak share the database network and rely on separate database credentials, database CONNECT privileges and RLS. The application and worker retain outbound connectivity for configured dependencies. Enforce per-destination egress at the host or network perimeter. The webhook worker pins approved resolved addresses, validates TLS against the approved hostname and rejects redirects.

Caddy derives forwarded scheme and authority from `AUTH_URL`, removes extra inbound forwarding fields, limits request bodies to 8 MiB and uses header and idle timeouts without limiting streamed response duration. Keycloak administration and the master realm are blocked by default. The administration exception requires explicit opt-in and the loopback HTTP fixture configuration.

## Verification

- **Docker Desktop (Engine 29.9.2, Compose v5.6.1)** — built the runtime image and booted fresh disposable stacks. Pre-hardening and hardened stacks both passed **31 Vitest and 8 Chromium tests**. Tests covered browser OIDC, guest and researcher triage, evidence, roles, scoring, achievements, leaderboards, live REST/MCP OAuth and authenticated writes, and SMTP and signed webhook retry. Read-only roots, effective UID, capability mask, no-new-privileges and resource settings passed the runtime checker. The HTTPS-only fixture exposed only IPv4 loopback TCP 18443. No backend had a host binding.
- **Persistence and recovery** — PostgreSQL outage caused readiness to return 503. Keycloak outage caused discovery to return 502 while the application health check remained 200. Both recovered on restart. The notification fixture exercised transient SMTP rejection and webhook HTTP 503 followed by recovery. A webhook timeout was not separately injected. Report count and attachment SHA-256 survived these outages and application, worker and Caddy restarts. Both database archives and the attachment tar restored into fresh Docker volumes. After restoration, Keycloak login and authorized attachment download worked. An outsider received 404 for the report and evidence. No existing deployment volumes were modified.
- **TLS** — Caddy's bundled HTTPS listener served the expected discovery issuer and app health over a verified private certificate. Chromium login, session reload and app logout passed. A separate outer TLS proxy preserved the public HTTPS issuer through the inner HTTP hop. The public Keycloak administration path returned 404. A separate application stack with the bundled Keycloak profile disabled also signed in and out successfully using the remote HTTPS issuer.
- **Rootless Docker and Podman** — unverified. The available Docker daemon does not report rootless mode, and Podman is absent. The rootless scripts check the engine mode before any runtime assertions. Linux user namespace mappings, SELinux labels, provider behavior, delegated resource limits, IPv6 reachability from another host and reboot persistence still require target-host validation.
- **Offline** — the final image's Node runtime and scripts were checked with networking disabled. Full disconnected deployment and restart were not exercised. Images and their pinned digests must be loaded before disconnecting. Provide local DNS, TLS trust and any required identity or notification endpoints.

## Supply chain findings

Gitleaks scanned the pre-hardening Git history with no leaks detected. The production npm audit reported zero vulnerabilities. Trivy 0.76.2 produced CycloneDX SBOMs for the application and three upstream service images. The image severity gate reported findings and returned nonzero.

| Image | High | Critical | Review |
| --- | ---: | ---: | --- |
| Final application | 48 | 0 | Debian base packages. The scan reported no fixed Debian versions for these findings. Removing bundled npm eliminated six high findings from its dependency tree. |
| PostgreSQL | 44 | 1 | Alpine packages and Go metadata in upstream gosu. The critical Go TLS finding is attributed to gosu, which is used for startup UID switching. Track the upstream rebuild. |
| Caddy | 2 | 0 | Go dependency findings in the pinned upstream binary. |
| Keycloak | 6 | 0 | Upstream base and Java dependency findings, including Guava. |

The runtime controls limit exposure. Treat the remaining image findings as open and rerun the scan before promotion. See [production deployment](DEPLOYMENT.md) for verification and rollback, and [backup and restore](deploy/README.md#backup-and-restore) for the commands used on disposable volumes.
