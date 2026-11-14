# Notifications

Configure one channel per SMTP recipient or HTTPS endpoint. Select report events and, optionally, validated severities. Use `pending` to include findings whose severity has yet to be validated. Report mutations and their queue entries commit together. Internal notes do not trigger deliveries.

The worker uses its own PostgreSQL credentials. It records every completed attempt and retries transient failures after 15 seconds, doubling up to one hour. `NOTIFICATION_MAX_ATTEMPTS` defaults to six. Authorized managers can enqueue test messages and retry dead deliveries. Editing a channel's routing details invalidates its pending deliveries. Creating a fresh test message verifies the current route.

Set `SMTP_FROM` to a bare email address and put the relay URL in the `smtp_url` secret file. Use `smtps://host:465` or `smtp://host:587` with STARTTLS. A disposable test relay can use `SMTP_ALLOW_PLAINTEXT=true`.

Set `WEBHOOK_DESTINATIONS` to a JSON map of approved HTTPS origins and expected DNS addresses, for example `{"https://hooks.internal":["10.10.0.5"]}`. Configure the worker network or host firewall to allow egress only to PostgreSQL, DNS, the relay, and approved webhook IPs and ports. To use an internal certificate authority, add its certificate to the deployment's internal CA secret. The worker connects directly to a validated address and verifies the original hostname over TLS.

Webhook requests use these headers:

- `X-BountyDeck-Event-Id` identifies the delivery across retries.
- `X-BountyDeck-Timestamp` carries the Unix timestamp of the attempt in seconds.
- `X-BountyDeck-Signature` carries `sha256=` followed by the lowercase hexadecimal HMAC-SHA256 of the timestamp, a period, and the raw request body.

Receivers should verify the signature, check timestamp freshness, and deduplicate by event ID. Deliveries are at least once. A crash after an endpoint accepts a request but before the worker commits can repeat the request. Email has a stable Message-ID across retries.

## Checks

Run `npx vitest run notifications` for the notification policy tests. Set `TEST_NOTIFICATION_ADMIN_URL` and `TEST_NOTIFICATION_WORKER_URL` to an isolated, migrated PostgreSQL database to include the concurrent worker test. Use an administrator connection and the dedicated worker role, respectively.

Run `psql -X -v ON_ERROR_STOP=1 -f notifications/database.test.sql` as an administrator on a migrated test database to check subscriptions, internal note exclusion, severity filtering, and scoped operations. The SQL fixture rolls back.

Signed-in users can open the bell or **Settings → Manage webhooks** to configure
one personal webhook. It uses the same approved HTTPS destinations, signatures,
and retry worker as program webhooks. Personal report events cover the user's
own reports and exclude internal comments. Program events cover published
programs the user can access. The page lists recent delivery outcomes.
