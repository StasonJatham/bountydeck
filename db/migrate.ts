import { flushLogs, logEvent } from "../lib/telemetry/logger.ts";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required");
  const pool = new Pool({ connectionString });
  try {
    // Serializes migration runs from independent deployments.
    const client = await pool.connect();
    try {
      await client.query("select pg_advisory_lock(1764138568)");
      await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
    } finally {
      // End the session to release its advisory lock.
      client.release(true);
    }
  } finally {
    await pool.end();
  }
}

main()
  .then(
    () => {
      logEvent({
        service: "migrate",
        action: "database.migration_completed",
        message: "Database migrations completed",
        outcome: "success",
      });
    },
    () => {
      logEvent({
        service: "migrate",
        level: "error",
        action: "database.migration_failed",
        message: "Database migration failed",
        outcome: "failure",
      });
      process.exitCode = 1;
    },
  )
  .finally(flushLogs);
