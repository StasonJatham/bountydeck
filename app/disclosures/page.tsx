import Link from "next/link";
import { z } from "zod";
import { SiteHeader } from "../../components/site-header";
import { getBranding } from "../../lib/branding";
import { getI18n } from "../../lib/i18n";
import { publicDisclosures } from "../../lib/integrations/public-disclosures";

export default async function Disclosures({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const { t } = await getI18n();
  const { items, nextCursor } = await publicDisclosures(
    "report",
    z.uuid().safeParse(cursor).data,
  );
  return (
    <>
      <SiteHeader brand={await getBranding()} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 p-6">
        <h1 className="text-3xl font-semibold">{t("Disclosed reports")}</h1>
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map(({ id, title }) => (
              <li key={id} className="py-3">
                <Link
                  className="wrap-anywhere text-accent underline"
                  href={`/disclosures/${id}`}
                >
                  {title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("No public reports have been disclosed.")}</p>
        )}
        {nextCursor && (
          <Link
            className="text-accent underline"
            href={`/disclosures?cursor=${nextCursor}`}
          >
            {t("Next page")}
          </Link>
        )}
      </main>
    </>
  );
}
