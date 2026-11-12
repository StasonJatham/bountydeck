# Testing

```sh
npm ci
npm run typecheck
npm run lint
npm run format
npm run build
npm audit --omit=dev --audit-level high
npm test
```

Run `npm run check:achievements` to validate the badge catalog, rule descriptors, and all 30 SVG assets. The build and test commands run this check automatically.

## Real PostgreSQL

Use a disposable migrated database. Set `RLS_TEST_DATABASE_URL` to a login that can set the application and worker roles. Set `TEST_NOTIFICATION_ADMIN_URL` to a login that can create and remove notification fixtures and `TEST_NOTIFICATION_WORKER_URL` to the restricted worker login. Run `npm test` with all three URLs to include the database and live SMTP retry checks. The worker test runs a local SMTP receiver and two competing worker processes. Without these URLs, the relevant tests are skipped.

## Browser and deployment

Follow [the disposable Compose fixture setup](deploy/README.md#disposable-test-fixtures), install Chromium with `npx playwright install chromium`, and run `npm run e2e`. Set `E2E_USE_SYSTEM_CHROME=1` to use an installed Google Chrome. Set `E2E_PASSWORD` if the test password file is stored elsewhere. The browser tests write synthetic reports and organizations to the fixture database. Treat browser traces as confidential if pointed at a live environment.

For deployment verification, start the application with empty volumes and with prebuilt images on isolated networks. Verify health and OIDC discovery, then restore backups into a separate Compose project. Check restored database policies, identity records, and attachment bytes.

For the browser-to-worker notification test, start the disposable fixture stack with its test-only SMTP and HTTPS receivers. The receivers reject the first delivery and accept the retry. The HTTPS receiver also verifies the signature and excludes confidential report text.

```sh
./deploy/provision-test-notifications.sh
docker compose -f compose.yaml -f deploy/compose.test.yaml \
  -f deploy/compose.notification-test.yaml --profile keycloak up -d --no-build --wait
E2E_NOTIFICATION_FIXTURE=1 npm run e2e
```

Use this overlay only with the disposable fixture deployment. Its self-signed receiver certificate and HMAC are generated locally.

To include anonymous submission and triage, start the fixture application with `BOUNTYDECK_GUEST_REPORTS=true` and run `E2E_GUEST_REPORTS=1 npm run e2e`. Use `E2E_ORIGIN` if your local fixture uses a different origin.

Use a fresh fixture deployment for repeated acceptance runs. The fixture researcher is subject to the same hourly submission limit as every other account.

## REST and MCP

Run `npx vitest run lib/integrations/openapi.test.ts lib/integration-skills.test.ts` to check generated contracts and skill packages.

For real OAuth tests, start the disposable Keycloak fixture, provision its integration clients with `./deploy/provision-test-integrations.sh`, and enable the canonical `http://bountydeck.test/mcp` audience, HTTP fixture mode, and the generated service binding in the application container. Use the loopback database from the Compose test override. Then run:

```sh
RUN_INTEGRATION_AUTH_FIXTURE=1 RUN_INTEGRATION_HTTP_FIXTURE=1 \
  INTEGRATION_CHROME_CHANNEL=chrome npx vitest run lib/integrations/auth.integration.test.ts
```

The test uses real OAuth exchanges and disposable case records. It verifies browser, REST, and MCP access, record isolation, idempotent writes, scoring, audit history, notification queue effects, and revocation.

## Logging

Run `npx vitest run lib/telemetry/logger.test.ts` to check ECS fields, OTLP mapping, request-data exclusion, and stdout fallback when a local OTLP receiver rejects a batch.
