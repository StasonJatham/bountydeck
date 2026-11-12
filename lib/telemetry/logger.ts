import { readFileSync } from "node:fs";

type Level = "info" | "warn" | "error";
type Service = "application" | "worker" | "migrate";
type Event = {
  service: Service;
  action: string;
  message: string;
  level?: Level;
  outcome?: "success" | "failure" | "unknown";
  durationNs?: number;
  route?: string;
  method?: string;
  status?: number;
  requestId?: string;
  traceparent?: string | null;
  deliveryId?: string;
  attempt?: number;
  result?: string;
  errorType?: string;
  deliveryStatus?: "pending" | "delivered" | "dead";
};

const severity: Record<Level, number> = { info: 9, warn: 13, error: 17 };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const serviceName = (service: Service) => `bountydeck-${service}`;

export function logRecord(event: Event, now = new Date()) {
  const trace = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(
    event.traceparent ?? "",
  );
  const traceId =
    trace && !/^0+$/.test(trace[1]) && !/^0+$/.test(trace[2])
      ? trace[1]
      : undefined;
  return {
    "@timestamp": now.toISOString(),
    "ecs.version": "8.11.0",
    "log.level": event.level ?? "info",
    "service.name": serviceName(event.service),
    "event.dataset": `bountydeck.${event.service}`,
    "event.kind": "event",
    "event.action": event.action,
    "event.outcome": event.outcome ?? "unknown",
    message: event.message,
    "event.duration": event.durationNs,
    "http.route": event.route,
    "http.request.method": event.method,
    "http.response.status_code": event.status,
    "http.request.id": uuid.test(event.requestId ?? "")
      ? event.requestId
      : undefined,
    "trace.id": traceId,
    "bountydeck.notification.id": uuid.test(event.deliveryId ?? "")
      ? event.deliveryId
      : undefined,
    "bountydeck.notification.attempt": event.attempt,
    "bountydeck.notification.status": event.deliveryStatus,
    "error.type": /^[A-Za-z0-9_.-]{1,80}$/.test(event.errorType ?? "")
      ? event.errorType
      : undefined,
    "bountydeck.notification.result": /^[a-z0-9_]{1,64}$/.test(
      event.result ?? "",
    )
      ? event.result
      : undefined,
  };
}

type RecordData = ReturnType<typeof logRecord>;

export function otlpPayload(records: RecordData[]) {
  const groups = Map.groupBy(records, (record) => record["service.name"]);
  return {
    resourceLogs: Array.from(groups, ([name, entries]) => ({
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: name } }],
      },
      scopeLogs: [
        {
          scope: { name: "bountydeck.logging" },
          logRecords: entries.map((entry) => {
            const {
              "@timestamp": timestamp,
              "log.level": level,
              "service.name": _service,
              "trace.id": traceId,
              message,
              ...attributes
            } = entry;
            return {
              timeUnixNano: String(BigInt(Date.parse(timestamp)) * 1_000_000n),
              severityNumber: severity[level],
              severityText: level.toUpperCase(),
              body: { stringValue: message },
              ...(traceId ? { traceId } : {}),
              attributes: Object.entries(attributes).flatMap(([key, value]) =>
                value === undefined
                  ? []
                  : [
                      {
                        key,
                        value:
                          typeof value === "number"
                            ? { intValue: String(value) }
                            : { stringValue: value },
                      },
                    ],
              ),
            };
          }),
        },
      ],
    })),
  };
}

function exporterConfig() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  if (!endpoint) return null;
  const url = URL.parse(endpoint);
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid OTLP endpoint");
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  const file = process.env.BOUNTYDECK_OTLP_HEADERS_FILE;
  const configured = file
    ? readFileSync(file, "utf8").trim()
    : process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS;
  for (const entry of configured?.trim() ? configured.split(",") : []) {
    const split = entry.indexOf("=");
    if (split < 1) throw new Error("Invalid OTLP headers");
    const name = entry.slice(0, split).trim();
    if (/^(content-type|content-length|host)$/i.test(name))
      throw new Error("Invalid OTLP header");
    headers.set(name, decodeURIComponent(entry.slice(split + 1).trim()));
  }
  return { url, headers };
}

let config: ReturnType<typeof exporterConfig> | undefined;
let configFailed = false;
let pending: RecordData[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let active: Promise<void> | undefined;
let warningAt = 0;

function warning(action: string, message: string) {
  if (Date.now() - warningAt < 60_000) return;
  warningAt = Date.now();
  console.error(
    JSON.stringify(
      logRecord({
        service:
          process.env.BOUNTYDECK_SERVICE === "worker"
            ? "worker"
            : process.env.BOUNTYDECK_SERVICE === "migrate"
              ? "migrate"
              : "application",
        level: "warn",
        action,
        message,
        outcome: "failure",
      }),
    ),
  );
}

function schedule() {
  if (timer || active || !pending.length) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flushLogs();
  }, 1_000);
  timer.unref();
}

export async function flushLogs() {
  if (active) return active;
  if (!config || !pending.length) return;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  const batch = pending.splice(0, 32);
  const { url, headers } = config;
  active = (async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(otlpPayload(batch)),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(2_000),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("OTLP rejected batch");
    } catch {
      warning(
        "telemetry.export_failed",
        "OTLP log export failed. Records remain available on stdout.",
      );
    }
  })();
  try {
    await active;
  } finally {
    active = undefined;
    schedule();
  }
}

export function logEvent(event: Event) {
  const record = logRecord(event);
  console.log(JSON.stringify(record));
  if (!configFailed && config === undefined) {
    try {
      config = exporterConfig();
    } catch {
      configFailed = true;
      warning(
        "telemetry.config_invalid",
        "OTLP log configuration is invalid. Records remain available on stdout.",
      );
    }
  }
  if (!config) return;
  if (pending.length >= 256) {
    warning(
      "telemetry.queue_full",
      "OTLP log queue is full. Records remain available on stdout.",
    );
    return;
  }
  pending.push(record);
  schedule();
}
