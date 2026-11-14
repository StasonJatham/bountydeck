import { sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "../db";

export const getBranding = cache(async () => {
  const {
    rows: [brand],
  } = await db.execute<{
    name: string;
    accent: string | null;
    custom_logo: boolean;
  }>(sql`select name, accent, logo is not null as custom_logo from branding`);
  return {
    name: brand.name,
    accent: brand.accent,
    foreground: brand.accent ? contrastColor(brand.accent) : null,
    logo: brand.custom_logo ? "/api/branding/logo" : "/brand/icon.svg",
  };
});

function contrastColor(hex: string) {
  const channels = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}
