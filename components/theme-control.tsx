import { cookies } from "next/headers";
import { getI18n } from "../lib/i18n";
import { readTheme } from "../lib/theme";
import { ThemeSelect } from "./theme-select";

export async function ThemeControl() {
  const theme = readTheme(await cookies());
  const { t } = await getI18n();
  return <ThemeSelect initialTheme={theme} label={t("Dark mode")} />;
}
