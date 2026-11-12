import { loggedRoute } from "../../../lib/telemetry/http";
import { Pool } from "pg";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 2000,
});

async function handle() {
  try {
    if (!process.env.DATABASE_URL)
      return Response.json({ status: "unavailable" }, { status: 503 });
    await pool.query("SELECT 1");
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}

export const GET = loggedRoute("/api/health", handle, { failuresOnly: true });
