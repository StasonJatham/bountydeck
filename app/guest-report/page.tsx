import Link from "next/link";
import { notFound } from "next/navigation";
import { getGuestPrograms, guestReportsEnabled } from "../../lib/guest-reports";
import { getI18n } from "../../lib/i18n";

export default async function GuestReports({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  if (!guestReportsEnabled()) notFound();
  const { t } = await getI18n();
  const { submitted } = await searchParams;
  const programs = await getGuestPrograms();
  return (
    <>
      <h1 className="text-3xl font-semibold">{t("Report anonymously")}</h1>
      {submitted === "1" && (
        <p role="status">
          {t("Your report was sent to the program’s reviewers.")}
        </p>
      )}
      <p className="text-muted">
        {t(
          "Guest reports are sent without an account and cannot be tracked or earn points. Leave identifying details out of the report.",
        )}
      </p>
      {programs.length ? (
        <ul className="space-y-3">
          {programs.map((program) => (
            <li key={program.id}>
              <Link className="underline" href={`/guest-report/${program.id}`}>
                {program.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("No programs are accepting guest reports.")}</p>
      )}
    </>
  );
}
