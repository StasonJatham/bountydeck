import { Pool } from "pg";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 2000,
});

export async function GET() {
  try {
    if (!process.env.DATABASE_URL)
      return Response.json({ status: "unavailable" }, { status: 503 });
    await pool.query("SELECT 1");
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
