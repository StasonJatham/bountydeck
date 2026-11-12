export const themeCookie = "bountydeck-theme";
export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

export function parseTheme(value: string | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

export function readTheme(cookies?: {
  get(name: string): { value: string } | undefined;
}): Theme {
  return parseTheme(
    cookies?.get(themeCookie)?.value ?? cookies?.get("bossob-theme")?.value,
  );
}
