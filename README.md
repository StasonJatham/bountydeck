# Bossob

Bossob is a self-hosted internal bug bounty platform. Employees sign in through OIDC, find eligible programs, submit confidential reports, and earn points for validated findings. Security teams manage programs, evidence, triage, recognition, and delivery from one installation.

## Start a local installation

Use Docker Compose v2 and resolve `bossob.test` to `127.0.0.1` on the browser host.

```sh
cp .env.example .env
./deploy/init-secrets.sh keycloak
docker compose --profile keycloak pull postgres reverse-proxy keycloak
docker compose --profile keycloak build application
docker compose run --rm migrate
docker compose --profile keycloak up -d --no-build --wait
```

Open [Bossob](http://bossob.test). Create the first identity in Keycloak, sign in once, then grant platform access with the operator command in the [deployment guide](deploy/README.md). The guide also covers an existing OIDC provider, private TLS, offline operation, upgrades, and backup and restore.

Platform administrators create organizational units and grant access. Organization administrators create programs and nominate program managers. Researchers can copy their user ID from their profile when requesting access to a restricted program.

## Development

Use Node.js 24 or later. Run `npm ci`, `npm run dev`, and the checks in [TESTING.md](TESTING.md). The [backlog](TASKS.md) records delivery and verification status.

Released under [AGPL-3.0-only](LICENSE).
