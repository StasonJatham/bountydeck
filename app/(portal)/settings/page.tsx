import { LocaleControl } from "../../../components/locale-control";
import { ThemeControl } from "../../../components/theme-control";
import Link from "next/link";
import { panel } from "../../../lib/forms";
import { getI18n } from "../../../lib/i18n";

export default async function Settings() {
  const { t } = await getI18n();
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{t("Settings")}</h1>
      <div className="mt-6 grid max-w-2xl gap-4">
        <section className={panel}>
          <h2 className="font-semibold">{t("Notifications")}</h2>
          <Link
            href="/notifications"
            className="mt-3 inline-block text-sm font-medium text-accent underline"
          >
            {t("Manage webhooks")}
          </Link>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Preferences")}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <LocaleControl />
            <ThemeControl />
          </div>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Profile settings")}</h2>
          <Link
            className="mt-3 inline-block text-sm font-medium text-accent underline"
            href="/profile"
          >
            {t("Researcher profile")}
          </Link>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Integrations")}</h2>
          <Link
            className="mt-3 inline-block text-sm font-medium text-accent underline"
            href="/integrations"
          >
            {t("Connect a client")}
          </Link>
        </section>
      </div>
    </>
  );
}
