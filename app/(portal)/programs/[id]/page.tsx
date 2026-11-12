import { ReportBadge } from "../../../../components/report-badge";
import { getI18n } from "../../../../lib/i18n";
import { Button } from "../../../../components/ui/button";
import { joinProgram } from "../../../../lib/management";
import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withActor } from "../../../../db";
import {
  programMemberships,
  programs,
  programScopes,
  rewards,
} from "../../../../db/schema";
import { requireActor } from "../../../../lib/actor";
import { Field, input, panel, Text } from "../../../../lib/forms";
import { submitReport } from "../../../../lib/report-actions";
import { severities } from "../../../../lib/workflow";

export default async function Program({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { t, number } = await getI18n();
  const actor = await requireActor();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        program: programs,
        eligible: sql<boolean>`app_can_submit(${programs.id})`,
        manages: sql<boolean>`app_manages_program(${programs.id})`,
      })
      .from(programs)
      .where(eq(programs.id, id));
    if (!row) notFound();
    const scope = await tx
      .select()
      .from(programScopes)
      .where(eq(programScopes.programId, id))
      .orderBy(programScopes.name);
    const offers = await tx
      .select()
      .from(rewards)
      .where(eq(rewards.programId, id));
    const [membership] = await tx
      .select({ userId: programMemberships.userId })
      .from(programMemberships)
      .where(
        and(
          eq(programMemberships.programId, id),
          eq(programMemberships.userId, actor),
          eq(programMemberships.role, "researcher"),
        ),
      );
    return { ...row, scope, offers, joined: Boolean(membership) };
  });
  const { program, eligible, manages, scope, offers, joined } = result;
  const error = (await searchParams).error;
  const assets = scope.filter((asset) => asset.inScope);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="grid content-start gap-4">
        {manages && (
          <Link
            className="w-fit text-sm font-medium"
            href={`/programs/${id}/manage`}
          >
            {t("Manage program →")}
          </Link>
        )}
        <div>
          <ReportBadge status={program.status}>{t(program.status)}</ReportBadge>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {program.name}
          </h1>
          <p className="mt-3 whitespace-pre-wrap text-secondary">
            {program.description}
          </p>
        </div>
        {eligible && (assets.length > 0 || !joined) && (
          <div className="flex flex-wrap items-center gap-2">
            {assets.length > 0 && (
              <a
                className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover hover:no-underline lg:hidden"
                href="#submit-report"
              >
                {t("Submit a report")}
              </a>
            )}
            {!joined && (
              <form action={joinProgram.bind(null, id)}>
                <Button variant="outline">{t("Join program")}</Button>
              </form>
            )}
          </div>
        )}
        <section className={panel}>
          <h2 className="font-semibold">{t("Points and rewards")}</h2>
          <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
            {severities.map((severity) => (
              <li className="capitalize" key={severity}>
                {t(severity)} ·{" "}
                <span className="font-mono text-xs">
                  {number(program.scoring[severity] ?? 0)}
                </span>{" "}
                {t("points")}
              </li>
            ))}
          </ul>
          {offers.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {offers.map((reward) => (
                <li key={reward.id}>
                  <strong>{reward.name}</strong> ·{" "}
                  {number(reward.minimumPoints)} {t("points")}
                  <p>{reward.description}</p>
                </li>
              ))}
            </ul>
          )}
          <Link
            className="mt-4 inline-block text-sm underline"
            href={`/leaderboard?scope=program:${id}`}
          >
            {t("Program leaderboard")}
          </Link>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Scope")}</h2>
          <ul className="mt-3 space-y-3">
            {scope.map((asset) => (
              <li key={asset.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="break-words">{asset.name}</strong>
                  <ReportBadge status={asset.inScope ? "published" : undefined}>
                    {asset.inScope ? t("In scope") : t("Out of scope")}
                  </ReportBadge>
                </div>
                <p>{asset.description}</p>
              </li>
            ))}
          </ul>
          {!scope.length && (
            <p className="mt-2 text-sm">{t("No assets defined.")}</p>
          )}
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Testing rules")}</h2>
          <p className="mt-2 whitespace-pre-wrap">{program.rules}</p>
          <h2 className="mt-5 font-semibold">{t("Disclosure policy")}</h2>
          <p className="mt-2 whitespace-pre-wrap">{program.disclosurePolicy}</p>
        </section>
      </div>
      {!eligible && (
        <p className="text-sm text-muted">
          {t("This program isn’t accepting submissions from your account.")}
        </p>
      )}
      {eligible && assets.length === 0 && (
        <p className="text-sm text-muted">
          {t("This program has no in-scope assets yet.")}
        </p>
      )}
      {eligible && assets.length > 0 && (
        <form
          id="submit-report"
          tabIndex={-1}
          action={submitReport.bind(null, id)}
          className={`${panel} grid scroll-mt-20 content-start gap-4 [&_textarea[name=proofOfConcept]]:font-mono [&_textarea[name=steps]]:font-mono`}
        >
          <h2 className="text-xl font-semibold">{t("Submit a report")}</h2>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error === "rate-limit"
                ? t("Submission limit reached. Try again later.")
                : t("Check the report fields and try again.")}
            </p>
          )}
          <Text name="title" label={t("Title")} />
          <Field label={t("Affected asset")}>
            <select className={input} name="assetId" required>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </Field>
          <Text name="cwe" label={t("Weakness (e.g. CWE-200)")} max={9} />
          <Field label={t("Proposed severity")}>
            <select className={input} name="proposedSeverity">
              {severities.map((severity) => (
                <option key={severity} value={severity}>
                  {t(severity)}
                </option>
              ))}
            </select>
          </Field>
          <Text
            name="description"
            label={t("Description")}
            multiline
            max={12000}
          />
          <Text
            name="steps"
            label={t("Reproduction steps")}
            multiline
            max={12000}
          />
          <Text
            name="proofOfConcept"
            label={t("Proof of concept")}
            multiline
            max={12000}
          />
          <Text name="impact" label={t("Impact")} multiline max={12000} />
          <Button>{t("Submit report")}</Button>
        </form>
      )}
    </div>
  );
}
