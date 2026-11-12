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

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
