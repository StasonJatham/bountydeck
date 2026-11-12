import { Client } from "pg";
import { z } from "zod";

const actor = z.uuid().parse(process.argv[2]);
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const client = new Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actor]);
  const { rows } = await client.query<{ changed: number }>(
    "SELECT app_achievement_reconcile() AS changed",
  );
  await client.query("COMMIT");
  console.log(`Achievement awards updated: ${rows[0].changed}`);
} finally {
  await client.end();
}
