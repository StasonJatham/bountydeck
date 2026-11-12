import { AchievementReview } from "../../../../components/achievement-review";
import { getManualAchievements } from "../../../../lib/manual-achievements";
import { guestReporterId } from "../../../../lib/guest-reports";
import { ReportBadge } from "../../../../components/report-badge";
import { getI18n } from "../../../../lib/i18n";
import { Button } from "../../../../components/ui/button";
import { uploadEvidence } from "../../../../lib/attachment-actions";
import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import { z } from "zod";
import { withActor } from "../../../../db";
import {
  platformSettings,
  programMemberships,
  reportAttachments,
  reportComments,
  reportEvents,
  scoreEvents,
  users,
} from "../../../../db/schema";
import { requireActor } from "../../../../lib/actor";
import { Field, input, panel, Text } from "../../../../lib/forms";
import {
  assign,
  comment,
  correctScore,
  transition,
} from "../../../../lib/report-actions";
import { readReport, ReportError } from "../../../../lib/integrations/reports";
import { severities, transitions } from "../../../../lib/workflow";

export default async function Report({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; achievement?: string }>;
}) {
  const { t, date, number, decimal } = await getI18n();
  const actor = await requireActor();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const {
    report,
    reviewer,
    manager,
    comments,
    events,
    attachments,
    assignees,
    awards,
    settings,
  } = await withActor(actor, async (tx) => {
    const row = await readReport(tx, id).catch((error: unknown) => {
      if (error instanceof ReportError && error.status === 404) notFound();
      throw error;
    });
    const comments = await tx
      .select()
      .from(reportComments)
      .where(eq(reportComments.reportId, id))
      .orderBy(reportComments.createdAt);
    const events = await tx
      .select()
      .from(reportEvents)
      .where(eq(reportEvents.reportId, id))
      .orderBy(reportEvents.createdAt);
    const attachments = await tx
      .select({ id: reportAttachments.id, name: reportAttachments.name })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, id));
    const assignees = row.reviewer
      ? await tx
          .selectDistinct({ id: users.id, name: users.name })
          .from(programMemberships)
          .innerJoin(users, eq(programMemberships.userId, users.id))
          .where(
            and(
              eq(programMemberships.programId, row.report.programId),
              inArray(programMemberships.role, ["manager", "triager"]),
            ),
          )
      : [];
    const awards = await tx
      .select({
        id: scoreEvents.id,
        points: scoreEvents.points,
        kind: scoreEvents.kind,
        reason: scoreEvents.reason,
      })
      .from(scoreEvents)
      .where(eq(scoreEvents.reportId, id))
      .orderBy(scoreEvents.createdAt);
    const [settings] = await tx
      .select({ reportExports: platformSettings.reportExports })
      .from(platformSettings);
    return {
      ...row,
      comments,
      events,
      attachments,
      assignees,
      awards,
      settings,
    };
  });
  if (report.contentRedactedAt) {
    return (
      <>
        <p className="font-mono text-xs text-muted">BSO-{report.number}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("Report content expired")}
        </h1>
        <p className="mt-4">
          {t(
            "The report’s content, discussion, and evidence were removed under the organization’s retention policy.",
          )}
        </p>
      </>
    );
  }
  const { error, achievement } = await searchParams;
  const manualAwards = manager ? await getManualAchievements(actor, id) : [];
  const canRecognize =
    report.reporterId !== guestReporterId &&
    report.reporterId !== actor &&
    ["validated", "remediation", "retesting", "resolved"].includes(
      report.status,
    );
  const options = transitions[report.status];
  return (
    <>
      <p className="text-sm text-muted">
        <span className="font-mono text-xs">BSO-{report.number}</span>
        {" · "}
        <ReportBadge status={report.status}>
          {t(report.status.replaceAll("_", " "))}
        </ReportBadge>
      </p>
      <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight">
        {report.title}
      </h1>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="font-mono text-xs">{report.cwe}</span>
        <ReportBadge severity={report.severity ?? report.proposedSeverity}>
          {t("{level} severity", {
            level: t(report.severity ?? report.proposedSeverity),
          })}
        </ReportBadge>
        {report.reporterId === guestReporterId && (
          <span>{t("Anonymous guest")}</span>
        )}
        {report.cvssScore !== null && (
          <span className="font-mono text-xs">
            CVSS {decimal(report.cvssScore)}
          </span>
        )}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {t("The change could not be saved. Check the form and try again.")}
        </p>
      )}
      {settings.reportExports &&
        process.env.REPORT_EXPORTS_ENABLED !== "false" && (
          <a
            className="mt-3 inline-block text-sm underline"
            href={`/api/reports/${id}/export`}
          >
            {t("Export report")}
          </a>
        )}
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <div className="min-w-0 space-y-5">
          <section className={panel}>
            {[
              ["Description", report.description],
              ["Reproduction steps", report.steps],
              ["Proof of concept", report.proofOfConcept],
              ["Impact", report.impact],
            ].map(([label, value]) => (
              <div key={label} className="mb-5 last:mb-0">
                <h2 className="mb-2 font-semibold">{t(label)}</h2>
                <div className="markdown whitespace-pre-wrap break-words text-sm">
                  <Markdown disallowedElements={["img", "a"]} unwrapDisallowed>
                    {value}
                  </Markdown>
                </div>
              </div>
            ))}
          </section>
          <section className={panel}>
            <h2 className="text-lg font-semibold">{t("Discussion")}</h2>
            <ul className="divide-y divide-line">
              {comments.map((entry) => (
                <li className="py-3" key={entry.id}>
                  <p className="text-xs text-muted">
                    {entry.internal ? t("Internal note") : t("Comment")} ·{" "}
                    {date(entry.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {entry.body}
                  </p>
                </li>
              ))}
            </ul>
            <form action={comment.bind(null, id)} className="mt-4 grid gap-3">
              <Text
                name="body"
                label={t("Add a comment")}
                multiline
                max={5000}
              />
              {reviewer && (
                <label className="flex gap-2 text-sm">
                  <input type="checkbox" name="internal" /> {t("Internal note")}
                </label>
              )}
              <Button>{t("Post comment")}</Button>
            </form>
          </section>
        </div>
        <div className="space-y-5">
          <section className={panel}>
            <h2 className="font-semibold">{t("Evidence")}</h2>
            <ul className="my-3 space-y-2 text-sm">
              {attachments.map((file) => (
                <li key={file.id}>
                  <a
                    className="break-all underline"
                    href={`/api/evidence/${file.id}`}
                  >
                    {file.name}
                  </a>
                </li>
              ))}
            </ul>
            <form className="grid gap-3" action={uploadEvidence.bind(null, id)}>
              <Field label={t("Upload PNG or text (max. 5 MB)")}>
                <input
                  className="w-full text-sm"
                  name="evidence"
                  type="file"
                  accept="image/png,text/plain"
                  required
                />
              </Field>
              <Button>{t("Upload")}</Button>
            </form>
          </section>
          {reviewer && (
            <form
              className={`${panel} grid gap-3`}
              action={transition.bind(null, id)}
            >
              <h2 className="font-semibold">{t("Triage")}</h2>
              <Field label={t("Next status")}>
                <select name="status" className={input}>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {t(option.replaceAll("_", " "))}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Validated severity")}>
                <select
                  className={input}
                  name="severity"
                  defaultValue={report.severity ?? ""}
                >
                  <option value="">{t("Unchanged")}</option>
                  {severities.map((severity) => (
                    <option key={severity} value={severity}>
                      {t(severity)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("CVSS 4.0 vector")}>
                <input
                  className={input}
                  name="cvssVector"
                  defaultValue={report.cvssVector ?? ""}
                  maxLength={512}
                />
              </Field>
              {(options as readonly string[]).includes("duplicate") && (
                <Text
                  name="duplicateOf"
                  label={t("Duplicate report ID")}
                  required={false}
                  max={36}
                />
              )}
              <Button>{t("Update report")}</Button>
            </form>
          )}
          {reviewer && (
            <form
              className={`${panel} grid gap-3`}
              action={assign.bind(null, id)}
            >
              <h2 className="font-semibold">{t("Assignment")}</h2>
              <Field label={t("Assigned reviewer")}>
                <select
                  className={input}
                  name="assignee"
                  defaultValue={report.assigneeId ?? ""}
                >
                  <option value="">{t("Unassigned")}</option>
                  {assignees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name ?? person.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Button>{t("Save assignment")}</Button>
            </form>
          )}
          {reviewer && (
            <AchievementReview
              reportId={id}
              reproVerified={report.reproVerified}
              canVerify={canRecognize}
              canGrant={manager && canRecognize}
              manualAwards={manualAwards}
              result={achievement}
            />
          )}
          {awards.length > 0 && (
            <section className={panel}>
              <h2 className="font-semibold">{t("Points history")}</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {awards.map((award) => (
                  <li className="flex justify-between gap-3" key={award.id}>
                    <span>
                      {award.kind === "award" ? t(award.reason) : award.reason}
                    </span>
                    <strong>{number(award.points)}</strong>
                  </li>
                ))}
              </ul>
              {manager && (
                <form
                  className="mt-4 grid gap-3"
                  action={correctScore.bind(null, id)}
                >
                  <Field label={t("Points adjustment")}>
                    <input
                      name="points"
                      className={input}
                      type="number"
                      required
                    />
                  </Field>
                  <Text name="reason" label={t("Reason")} max={500} />
                  <Button>{t("Record correction")}</Button>
                </form>
              )}
            </section>
          )}
          <section className={panel}>
            <h2 className="font-semibold">{t("Timeline")}</h2>
            <ol className="mt-2 space-y-2 text-sm">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="capitalize">
                    {t(
                      event.kind.replace(/^report\./, "").replaceAll("_", " "),
                    )}
                  </span>
                  <time
                    className="ml-2 text-muted"
                    dateTime={event.createdAt.toISOString()}
                  >
                    {date(event.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
