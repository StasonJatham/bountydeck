import { flushLogs, logEvent } from "../lib/telemetry/logger.ts";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { createDeliveryTransport } from "./transport.ts";
import type { Delivery } from "./transport.ts";

type Job = Delivery & { attempts: number; retry_count: number };

const connectionString = process.env.WORKER_DATABASE_URL;
if (!connectionString) throw new Error("WORKER_DATABASE_URL is required");
const maxAttempts = Number(process.env.NOTIFICATION_MAX_ATTEMPTS ?? 6);
if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
  throw new Error("NOTIFICATION_MAX_ATTEMPTS must be between 1 and 20");
}
const send = (() => {
  try {
    return createDeliveryTransport(process.env);
  } catch {
    logEvent({
      service: "worker",
      level: "error",
      action: "worker.config_invalid",
      message: "Notification worker configuration is invalid",
      outcome: "failure",
    });
    throw new Error("Notification worker configuration is invalid");
  }
})();
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
});
pool.on("error", () =>
  logEvent({
    service: "worker",
    level: "error",
    action: "database.connection_lost",
    message: "Notification worker database connection lost",
    outcome: "failure",
  }),
);
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

async function processOne() {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const {
      rows: [job],
    } = await client.query<Job>(`
      SELECT o.id, o.program_id, o.report_id, o.public_report_id, o.event_type, o.severity,
             o.created_at, o.attempts, o.retry_count,
             c.enabled AND o.routing_revision = c.routing_revision AS enabled,
             c.destination, c.signing_secret, c.kind
      FROM notification_outbox o
      JOIN notification_channels c ON c.id = o.channel_id
      WHERE o.status = 'pending' AND o.available_at <= now()
      ORDER BY o.available_at, o.id
      LIMIT 1 FOR UPDATE OF o SKIP LOCKED
    `);
    if (!job) {
      await client.query("COMMIT");
      return false;
    }

    // ponytail: retain one row lock across delivery. Add committed leases only
    // if worker concurrency or long-running transports make that costly.
    const started = process.hrtime.bigint();
    const delivery = await send(job);
    const retryCount = job.retry_count + 1;
    const status =
      delivery.status === "retry"
        ? retryCount < maxAttempts
          ? "pending"
          : "dead"
        : delivery.status;
    const retrySeconds = Math.min(3_600, 15 * 2 ** (retryCount - 1));
    await client.query(
      `
      UPDATE notification_outbox
      SET status = $2, attempts = $3, retry_count = $4,
          available_at = CASE WHEN $2 = 'pending' THEN clock_timestamp() + make_interval(secs => $5)
                              ELSE available_at END
      WHERE id = $1
    `,
      [job.id, status, job.attempts + 1, retryCount, retrySeconds],
    );
    await client.query(
      `
      INSERT INTO notification_deliveries (outbox_id, attempt, result) VALUES ($1, $2, $3)
    `,
      [job.id, job.attempts + 1, delivery.result],
    );
    await client.query("COMMIT");
    logEvent({
      service: "worker",
      action: "notification.delivery_attempt",
      message: "Notification delivery attempt completed",
      level: status === "delivered" ? "info" : "warn",
      outcome: status === "delivered" ? "success" : "failure",
      deliveryId: job.id,
      attempt: job.attempts + 1,
      result: delivery.result,
      deliveryStatus: status,
      durationNs: Number(process.hrtime.bigint() - started),
    });
    return true;
  } catch (error) {
    discard = true;
    throw error;
  } finally {
    client.release(discard);
  }
}

logEvent({
  service: "worker",
  action: "worker.started",
  message: "Notification worker started",
});
try {
  while (!stopping) {
    try {
      if (!(await processOne())) await setTimeout(1_000);
    } catch {
      logEvent({
        service: "worker",
        level: "error",
        action: "notification.queue_failed",
        message: "Notification worker could not process queue",
        outcome: "failure",
      });
      if (!stopping) await setTimeout(5_000);
    }
  }
} finally {
  await pool.end();
  await flushLogs();
}
