import { cookies } from "next/headers";
import { getI18n } from "../lib/i18n";
import { readTheme } from "../lib/theme";
import { ThemeSelect } from "./theme-select";

export async function ThemeControl({
  compact = false,
}: { compact?: boolean } = {}) {
  const theme = readTheme(await cookies());
  const { t } = await getI18n();
  return (
    <ThemeSelect
      compact={compact}
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
