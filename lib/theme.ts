export const themeCookie = "bossob-theme";
export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

export function parseTheme(value: string | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
