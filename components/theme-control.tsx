import { cookies } from "next/headers";
import { getI18n } from "../lib/i18n";
import { parseTheme, themeCookie } from "../lib/theme";
import { ThemeSelect } from "./theme-select";

export async function ThemeControl() {
  const theme = parseTheme((await cookies()).get(themeCookie)?.value);
  const { t } = await getI18n();
  return (
    <ThemeSelect
      initialTheme={theme}
      labels={{
        label: t("Color theme"),
        system: t("System theme"),
        light: t("Light mode"),
        dark: t("Dark mode"),
      }}
    />
  );
}
