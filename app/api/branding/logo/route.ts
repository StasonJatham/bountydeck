import { sql } from "drizzle-orm";
import { db } from "../../../../db";

export async function GET() {
  const {
    rows: [brand],
  } = await db.execute<{ logo: Buffer | null }>(sql`select logo from branding`);
  if (!brand.logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(brand.logo), {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
