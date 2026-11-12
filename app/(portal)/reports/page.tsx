import { Button } from "../../../components/ui/button";
import Link from "next/link";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { withActor } from "../../../db";
import { programs, reports } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { Field, input, panel } from "../../../lib/forms";
import { severities, transitions, type Status } from "../../../lib/workflow";

const statuses = Object.keys(transitions) as Status[];

export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const query = await searchParams;
  const inbox = query.view === "inbox";
  const status = statuses.find((value) => value === query.status);
  const severity = severities.find((value) => value === query.severity);
  const before = Number(query.before);
  const { rows, canTriage } = await withActor(actor, async (tx) => {
    const [{ canTriage }] = (
      await tx.execute<{ canTriage: boolean }>(
        sql`select exists (select from programs where app_reviews_program(id)) as "canTriage"`,
      )
    ).rows;
    const rows = await tx
      .select({
        id: reports.id,
        title: reports.title,
        status: reports.status,
        number: reports.number,
        severity: sql<string>`coalesce(${reports.severity}, ${reports.proposedSeverity})`,
        program: programs.name,
      })
      .from(reports)
      .leftJoin(programs, eq(reports.programId, programs.id))
      .where(
        and(
          inbox
            ? sql`app_reviews_program(${reports.programId})`
            : eq(reports.reporterId, actor),
          status && eq(reports.status, status),
          severity &&
            sql`coalesce(${reports.severity}, ${reports.proposedSeverity}) = ${severity}`,
          Number.isSafeInteger(before) && before > 0
            ? lt(reports.number, before)
            : undefined,
        ),
      )
      .orderBy(desc(reports.number))
      .limit(31);
    return { rows, canTriage };
  });
  const next = new URLSearchParams({
    view: inbox ? "inbox" : "mine",
    status: status ?? "",
    severity: severity ?? "",
    before: String(rows[29]?.number ?? ""),
  });
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        {inbox ? "Triage inbox" : "My reports"}
      </h1>
      {canTriage && (
        <nav aria-label="Report views" className="mt-5 flex gap-5 text-sm">
          <Link href="/reports" aria-current={!inbox ? "page" : undefined}>
            My reports
          </Link>
          <Link
            href="/reports?view=inbox"
            aria-current={inbox ? "page" : undefined}
          >
            Triage inbox
          </Link>
        </nav>
      )}
      <form className="mt-6 flex flex-wrap items-end gap-3">
        {inbox && <input type="hidden" name="view" value="inbox" />}
        <Field label="Status">
          <select className={input} name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {statuses.map((state) => (
              <option key={state} value={state}>
                {state.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select
            className={input}
            name="severity"
            defaultValue={severity ?? ""}
          >
            <option value="">All severities</option>
            {severities.map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </Field>
        <Button>Apply filters</Button>
      </form>
      <div className={`${panel} mt-6 overflow-x-auto`}>
        {rows.length ? (
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="pb-3">Report</th>
                <th className="pb-3">Program</th>
                <th className="pb-3">Severity</th>
                <th className="pb-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rows.slice(0, 30).map((report) => (
                <tr key={report.id}>
                  <td className="py-3 pr-3">
                    <Link
                      href={`/reports/${report.id}`}
                      className="font-medium"
                    >
                      <span className="mr-2 whitespace-nowrap text-neutral-600">
                        BSO-{report.number}
                      </span>
                      {report.title}
                    </Link>
                  </td>
                  <td className="pr-3">{report.program ?? "—"}</td>
                  <td className="pr-3 capitalize">
                    <span
                      className={
                        report.severity === "critical" ||
                        report.severity === "high"
                          ? "font-medium text-red-800"
                          : undefined
                      }
                    >
                      {report.severity}
                    </span>
                  </td>
                  <td className="capitalize">
                    {report.status.replaceAll("_", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-neutral-600">
            No reports match these filters.
          </p>
        )}
      </div>
      {rows.length > 30 && (
        <Link className="mt-4 inline-block underline" href={`/reports?${next}`}>
          Next page
        </Link>
      )}
    </>
  );
}
