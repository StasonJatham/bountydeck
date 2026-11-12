# Collect BountyDeck logs

BountyDeck emits one JSON record per line to stdout for application requests, integration failures, authentication events, notification attempts, and database migrations. It uses Elastic Common Schema fields for service names, event outcomes, severity, and request IDs. Collect the `application`, `worker`, and `migrate` container logs with your existing Docker log collector. Caddy also emits its native JSON access logs for browser traffic, with request URLs, headers, and client addresses removed. [Elastic Common Schema log fields](https://www.elastic.co/docs/reference/ecs/ecs-log).

```sh
docker compose logs --no-log-prefix application worker |
  jq -Rc 'fromjson? | select(."ecs.version")'
```

For Elastic Agent or Filebeat, collect Docker stdout with the container parser, then decode the application line as JSON. Enable dotted-key expansion if your pipeline expects nested ECS fields. Filter on `event.dataset` values starting with `bountydeck.`. Handle Caddy and framework output as separate sources.

## Send logs to an OpenTelemetry Collector

Set the full OTLP/HTTP logs URL in `.env`, then recreate the application and worker. The Collector must be reachable from both containers. Use HTTPS for remote collectors or an isolated network for a local collector.

```dotenv
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://collector.example.internal:4318/v1/logs
```

BountyDeck sends OTLP/HTTP JSON to the configured receiver. Configure your Collector's logs pipeline with the OTLP HTTP receiver and an exporter for your backend. The Collector can forward to Elastic or another compatible backend. Keep one ingestion path per backend to avoid duplicate records. [OTLP specification](https://opentelemetry.io/docs/specs/otlp/), [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/).

For authentication, mount a private header file into each exporting container and set `BOUNTYDECK_OTLP_HEADERS_FILE` to its container path. The file uses OTLP header syntax, such as `Authorization=Bearer%20<token>`. A deployment secret manager can also supply `OTEL_EXPORTER_OTLP_LOGS_HEADERS`. Keep header values out of source control.

OTLP export is optional and best effort. Each process batches logs in a bounded in-memory queue with a two-second export timeout. An unavailable collector or full queue leaves the records on stdout and produces a throttled warning. Use a host collector with durable buffering if delivery guarantees are required.

## Correlate a request

- **Service** comes from `service.name`, such as `bountydeck-application` or `bountydeck-worker`.
- **Request** comes from `http.request.id` and the response's `X-Request-Id`. Integration requests use the same ID in the application audit trail.
- **Trace** comes from a valid incoming W3C `traceparent` header. BountyDeck correlates the log to that trace without emitting spans.
- **Latency** comes from `event.duration` in nanoseconds. For HTTP requests it measures time to response headers.
- **Notification delivery** comes from `bountydeck.notification.id`, the attempt number, queue status, and result code.

Application telemetry excludes request and response bodies, URL queries, cookies, tokens, report contents, and attachment names. Route templates take the place of raw resource URLs. Application audit history remains in BountyDeck. Apply your organization's access and retention rules to both logs and audit history. [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/), [W3C Trace Context](https://www.w3.org/TR/trace-context/).
