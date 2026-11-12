# Testing

```sh
npm ci
npm run typecheck
npm run lint
npm run format
npm run build
npm audit --omit=dev --audit-level high
npm run test:unit
```

Run `npm run check:achievements` to validate the badge catalog, rule descriptors, and all 30 SVG assets. The build and test commands run this check automatically. Use `npm run test:unit` for a fixture-free run. The full suites, `npm test` and `npm run e2e`, require the fixtures below and fail when a fixture is missing.

## Real PostgreSQL

Use a disposable migrated database. Set `RLS_TEST_DATABASE_URL` and `TEST_NOTIFICATION_ADMIN_URL` to a login that can create and remove fixtures and set the application and worker roles. Set `TEST_NOTIFICATION_WORKER_URL` to the restricted worker login. The notification test starts its own SMTP receiver and competing worker processes. The full Vitest run also requires the Keycloak and application fixtures in [REST and MCP](#rest-and-mcp).

## Browser and deployment

Follow [the disposable Compose fixture setup](deploy/README.md#disposable-test-fixtures) and install Chromium with `npx playwright install chromium`. The full browser suite needs guest reporting and the test notification receivers enabled. Set `E2E_USE_SYSTEM_CHROME=1` to use an installed Google Chrome. Set `E2E_PASSWORD` if the test password file is stored elsewhere. The browser tests write synthetic reports and organizations to the fixture database. Treat browser traces as confidential if pointed at a live environment.

For deployment verification, start the application with empty volumes and with prebuilt images on isolated networks. Verify health and OIDC discovery, then restore backups into a separate Compose project. Check restored database policies, identity records, and attachment bytes.

For the browser-to-worker notification test, start the disposable fixture stack with its test-only SMTP and HTTPS receivers. The receivers reject the first delivery and accept the retry. The HTTPS receiver also verifies the signature and excludes confidential report text.

```sh
./deploy/provision-test-notifications.sh
BOUNTYDECK_GUEST_REPORTS=true docker compose -f compose.yaml -f deploy/compose.test.yaml \
  -f deploy/compose.notification-test.yaml --profile keycloak up -d --no-build --wait
npm run e2e
```

Use this overlay only with the disposable fixture deployment. Its self-signed receiver certificate and HMAC are generated locally.

Use `E2E_ORIGIN` if your local fixture uses a different origin. To run a specific browser workflow, use `npm run e2e -- -g "test name"`.

Use a fresh fixture deployment for repeated acceptance runs. The fixture researcher is subject to the same hourly submission limit as every other account.

## REST and MCP

Run `npx vitest run lib/integrations/openapi.test.ts lib/integration-skills.test.ts` to check generated contracts and skill packages.

For real OAuth tests, start the disposable Keycloak fixture, provision its integration clients with `./deploy/provision-test-integrations.sh`, and enable the canonical `http://bountydeck.test/mcp` audience, HTTP fixture mode, and the generated service binding in the application container. Use the loopback database from the Compose test override. With the three PostgreSQL URLs set as above, run:

```sh
./deploy/provision-test-integrations.sh
BOUNTYDECK_GUEST_REPORTS=true INTEGRATION_AUDIENCE=http://bountydeck.test/mcp INTEGRATION_ALLOW_HTTP=true \
  INTEGRATION_SERVICE_CLIENTS="$(cat secrets/test_integration_service_binding)" \
  docker compose -f compose.yaml -f deploy/compose.test.yaml \
  -f deploy/compose.notification-test.yaml --profile keycloak up -d --no-deps --no-build --wait application
npm test
```

For a different fixture address or secrets directory, set `INTEGRATION_FIXTURE_ORIGIN`, `INTEGRATION_FIXTURE_DB_PORT`, or `INTEGRATION_FIXTURE_SECRETS`. Set `INTEGRATION_CHROME_CHANNEL=chrome` to use system Chrome. The OAuth test uses real OAuth exchanges and disposable case records. It verifies browser, REST, and MCP access, record isolation, idempotent writes, scoring, audit history, notification queue effects, and revocation.

## Logging

Run `npx vitest run lib/telemetry/logger.test.ts` to check ECS fields, OTLP mapping, request-data exclusion, and stdout fallback when a local OTLP receiver rejects a batch.
