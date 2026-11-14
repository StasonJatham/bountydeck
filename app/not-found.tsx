import { SiteHeader } from "../components/site-header";
import Link from "next/link";
import { getI18n } from "../lib/i18n";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="text-3xl font-semibold">{t("Page not found")}</h1>
        <Link className="mt-4 inline-block underline" href="/">
          {t("Back to home")}
        </Link>
      </main>
    </>
  );
}
