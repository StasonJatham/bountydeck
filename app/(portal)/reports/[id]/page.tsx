import { Button } from "../../../../components/ui/button";
import { uploadEvidence } from "../../../../lib/attachment-actions";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  reports,
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
import { severities, transitions } from "../../../../lib/workflow";

export default async function Report({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
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
    const [row] = await tx
      .select({
        report: reports,
        reviewer: sql<boolean>`app_reviews_program(${reports.programId})`,
        manager: sql<boolean>`app_manages_program(${reports.programId})`,
      })
      .from(reports)
      .where(eq(reports.id, id));
    if (!row) notFound();
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
        <p className="text-sm text-neutral-600">BSO-{report.number}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Report content expired
        </h1>
        <p className="mt-4">
          The report’s content, discussion, and evidence were removed under the
          organization’s retention policy.
        </p>
      </>
    );
  }
  const error = (await searchParams).error;
  const options = transitions[report.status];
  return (
    <>
      <p className="text-sm text-neutral-600">
        BSO-{report.number} ·{" "}
        <span className="capitalize">{report.status.replaceAll("_", " ")}</span>
      </p>
      <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight">
        {report.title}
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        {report.cwe} · {report.severity ?? report.proposedSeverity} severity
        {report.cvssScore !== null && ` · CVSS ${report.cvssScore.toFixed(1)}`}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-red-800">
          The change could not be saved. Check the form and try again.
        </p>
      )}
      {settings.reportExports &&
        process.env.REPORT_EXPORTS_ENABLED !== "false" && (
          <a
            className="mt-3 inline-block text-sm underline"
            href={`/api/reports/${id}/export`}
          >
            Export report
          </a>
        )}
      <div className="mt-6 grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="min-w-0 space-y-5">
          <section className={panel}>
            {[
              ["Description", report.description],
              ["Reproduction steps", report.steps],
              ["Proof of concept", report.proofOfConcept],
              ["Impact", report.impact],
            ].map(([label, value]) => (
              <div key={label} className="mb-5 last:mb-0">
                <h2 className="mb-2 font-semibold">{label}</h2>
                <div className="markdown whitespace-pre-wrap break-words text-sm">
                  <Markdown disallowedElements={["img", "a"]} unwrapDisallowed>
                    {value}
                  </Markdown>
                </div>
              </div>
            ))}
          </section>
          <section className={panel}>
            <h2 className="text-lg font-semibold">Discussion</h2>
            <ul className="divide-y divide-neutral-200">
              {comments.map((entry) => (
                <li className="py-3" key={entry.id}>
                  <p className="text-xs text-neutral-600">
                    {entry.internal ? "Internal note" : "Comment"} ·{" "}
                    {entry.createdAt.toISOString().slice(0, 10)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {entry.body}
                  </p>
                </li>
              ))}
            </ul>
            <form action={comment.bind(null, id)} className="mt-4 grid gap-3">
              <Text name="body" label="Add a comment" multiline max={5000} />
              {reviewer && (
                <label className="flex gap-2 text-sm">
                  <input type="checkbox" name="internal" /> Internal note
                </label>
              )}
              <Button>Post comment</Button>
            </form>
          </section>
        </div>
        <div className="space-y-5">
          <section className={panel}>
            <h2 className="font-semibold">Evidence</h2>
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
              <Field label="Upload PNG or text (max. 5 MB)">
                <input
                  className="w-full text-sm"
                  name="evidence"
                  type="file"
                  accept="image/png,text/plain"
                  required
                />
              </Field>
              <Button>Upload</Button>
            </form>
          </section>
          {reviewer && (
            <form
              className={`${panel} grid gap-3`}
              action={transition.bind(null, id)}
            >
              <h2 className="font-semibold">Triage</h2>
              <Field label="Next status">
                <select name="status" className={input}>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Validated severity">
                <select
                  className={input}
                  name="severity"
                  defaultValue={report.severity ?? ""}
                >
                  <option value="">Unchanged</option>
                  {severities.map((severity) => (
                    <option key={severity}>{severity}</option>
                  ))}
                </select>
              </Field>
              <Field label="CVSS 4.0 vector">
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
                  label="Duplicate report ID"
                  required={false}
                  max={36}
                />
              )}
              <Button>Update report</Button>
            </form>
          )}
          {reviewer && (
            <form
              className={`${panel} grid gap-3`}
              action={assign.bind(null, id)}
            >
              <h2 className="font-semibold">Assignment</h2>
              <Field label="Assigned reviewer">
                <select
                  className={input}
                  name="assignee"
                  defaultValue={report.assigneeId ?? ""}
                >
                  <option value="">Unassigned</option>
                  {assignees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name ?? person.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Button>Save assignment</Button>
            </form>
          )}
          {awards.length > 0 && (
            <section className={panel}>
              <h2 className="font-semibold">Points history</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {awards.map((award) => (
                  <li className="flex justify-between gap-3" key={award.id}>
                    <span>{award.reason}</span>
                    <strong>{award.points}</strong>
                  </li>
                ))}
              </ul>
              {manager && (
                <form
                  className="mt-4 grid gap-3"
                  action={correctScore.bind(null, id)}
                >
                  <Field label="Points adjustment">
                    <input
                      name="points"
                      className={input}
                      type="number"
                      required
                    />
                  </Field>
                  <Text name="reason" label="Reason" max={500} />
                  <Button>Record correction</Button>
                </form>
              )}
            </section>
          )}
          <section className={panel}>
            <h2 className="font-semibold">Timeline</h2>
            <ol className="mt-2 space-y-2 text-sm">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="capitalize">
                    {event.kind.replace(/^report\./, "").replaceAll("_", " ")}
                  </span>
                  <time
                    className="ml-2 text-neutral-600"
                    dateTime={event.createdAt.toISOString()}
                  >
                    {event.createdAt.toISOString().slice(0, 10)}
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
