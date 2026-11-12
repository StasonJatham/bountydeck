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

## Real PostgreSQL

Use a disposable migrated database. Set `RLS_TEST_DATABASE_URL` to a login that can set the application and worker roles. Set `TEST_NOTIFICATION_ADMIN_URL` to a login that can create and remove notification fixtures and `TEST_NOTIFICATION_WORKER_URL` to the restricted worker login. Run `npm test` with all three URLs to include the database and live SMTP retry checks. The worker test runs a local SMTP receiver and two competing worker processes. Without these URLs, the relevant tests are skipped.

## Browser and deployment

Follow [the disposable Compose fixture setup](deploy/README.md#disposable-test-fixtures), install Chromium with `npx playwright install chromium`, and run `npm run e2e`. Set `E2E_USE_SYSTEM_CHROME=1` to use an installed Google Chrome. Set `E2E_PASSWORD` if the test password file is stored elsewhere. The browser tests write synthetic reports and organizations to the fixture database. Treat browser traces as confidential if pointed at a live environment.

For deployment verification, start the application with empty volumes and with prebuilt images on isolated networks. Verify health and OIDC discovery, then restore backups into a separate Compose project. Check restored database policies, identity records, and attachment bytes.
