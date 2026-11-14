import { getI18n } from "../lib/i18n";
import { savePreference } from "../lib/preferences";
import { LocaleSelect } from "./locale-select";

export async function LocaleControl() {
  const { locale, t } = await getI18n();

  return (
    <LocaleSelect
      locale={locale}
      label={t("Language")}
      update={async (data: FormData) => {
        "use server";
        const selected = data.get("locale");
        if (selected !== "en" && selected !== "de") return;
        await savePreference({ locale: selected });
      }}
    />
  );
}
