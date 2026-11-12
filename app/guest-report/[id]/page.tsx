import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ReportForm } from "../../../components/report-form";
import { withActor } from "../../../db";
import { programScopes } from "../../../db/schema";
import {
  guestPrograms,
  guestReporterId,
  guestReportsEnabled,
} from "../../../lib/guest-reports";
import { getI18n } from "../../../lib/i18n";
import { submitGuestReport } from "../../../lib/report-actions";

export default async function GuestReport({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  if (!guestReportsEnabled() || !z.uuid().safeParse(id).success) notFound();
  const { t } = await getI18n();
  const { error } = await searchParams;
  const { program, assets } = await withActor(guestReporterId, async (tx) => {
    const [program] = await guestPrograms(tx, id);
    if (!program) notFound();
    const assets = await tx
      .select({ id: programScopes.id, name: programScopes.name })
      .from(programScopes)
      .where(
        and(eq(programScopes.programId, id), eq(programScopes.inScope, true)),
      )
      .orderBy(asc(programScopes.name));
    return { program, assets };
  });
  if (!assets.length) notFound();

  return (
    <>
      <Link className="underline" href="/guest-report">
        {t("Report anonymously")}
      </Link>
      <h1 className="text-3xl font-semibold">{program.name}</h1>
      {program.rules && <p className="whitespace-pre-wrap">{program.rules}</p>}
      <p className="text-muted">
        {t(
          "Guest reports are sent without an account and cannot be tracked or earn points. Leave identifying details out of the report.",
        )}
      </p>
      <ReportForm
        action={submitGuestReport.bind(null, id)}
        assets={assets}
        error={error}
      />
    </>
  );
}
