import Markdown from "react-markdown";
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
import { panel } from "../../../../lib/forms";
import { submitReport } from "../../../../lib/report-actions";
import { severities } from "../../../../lib/workflow";
import { ReportForm } from "../../../../components/report-form";

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
                {asset.target && (
                  <p className="wrap-anywhere text-sm">
                    <span className="uppercase text-muted">
                      {asset.targetType}
                    </span>{" "}
                    <code>{asset.target}</code>
                  </p>
                )}
                <p className="whitespace-pre-wrap wrap-anywhere">
                  {asset.description}
                </p>
              </li>
            ))}
          </ul>
          {!scope.length && (
            <p className="mt-2 text-sm">{t("No assets defined.")}</p>
          )}
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Testing rules")}</h2>
          <div className="markdown mt-2 max-h-96 overflow-auto wrap-anywhere">
            <Markdown skipHtml disallowedElements={["img"]}>
              {program.rules || t("No testing rules have been published.")}
            </Markdown>
          </div>
          <h2 className="mt-5 font-semibold">{t("Disclosure policy")}</h2>
          <div className="markdown mt-2 max-h-96 overflow-auto wrap-anywhere">
            <Markdown skipHtml disallowedElements={["img"]}>
              {program.disclosurePolicy ||
                t("No disclosure policy has been published.")}
            </Markdown>
          </div>
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
        <ReportForm
          action={submitReport.bind(null, id)}
          assets={assets}
          error={error}
        />
      )}
    </div>
  );
}
