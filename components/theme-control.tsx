import { getI18n } from "../lib/i18n";
import { getPreferences, savePreference } from "../lib/preferences";
import { ThemeSelect } from "./theme-select";

export async function ThemeControl() {
  const { theme } = await getPreferences();
  const { t } = await getI18n();
  return (
    <ThemeSelect
      theme={theme}
      label={t("Dark mode")}
      update={async (next) => {
        "use server";
        if (next === "light" || next === "dark")
          await savePreference({ theme: next });
      }}
    />
  );
}
