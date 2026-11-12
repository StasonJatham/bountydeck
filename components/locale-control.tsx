import { cookies } from "next/headers";
import { getI18n, localeCookie } from "../lib/i18n";
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
        const jar = await cookies();
        jar.set(localeCookie, selected, {
          path: "/",
          sameSite: "lax",
          httpOnly: true,
          maxAge: 31536000,
          secure: process.env.AUTH_URL?.startsWith("https:"),
        });
      }}
    />
  );
}
