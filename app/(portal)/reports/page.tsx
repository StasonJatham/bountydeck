import { getI18n } from "../../../lib/i18n";
import { Button } from "../../../components/ui/button";
import { ReportBadge } from "../../../components/report-badge";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { withActor } from "../../../db";
import { listReports } from "../../../lib/integrations/reports";
import { requireActor } from "../../../lib/actor";
import { Field, input } from "../../../lib/forms";
import { severities, transitions, type Status } from "../../../lib/workflow";

const statuses = Object.keys(transitions) as Status[];

export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { t } = await getI18n();
  const actor = await requireActor();
  const query = await searchParams;
  const inbox = query.view === "inbox";
  const status = statuses.find((value) => value === query.status);
  const severity = severities.find((value) => value === query.severity);
  const before = Number(query.before);
  const oldestFirst = query.sort === "oldest";
  const [{ items: rows, nextCursor }, canTriage] = await Promise.all([
    listReports(actor, {
      view: inbox ? "inbox" : "mine",
      sort: oldestFirst ? "oldest" : "newest",
      status,
      severity,
      cursor:
        Number.isInteger(before) && before > 0 && before <= 2147483647
          ? before
          : undefined,
    }),
    withActor(
      actor,
      async (tx) =>
        (
          await tx.execute<{ canTriage: boolean }>(
            sql`select exists (select from programs where app_reviews_program(id)) as "canTriage"`,
          )
        ).rows[0].canTriage,
    ),
  ]);
  const next = new URLSearchParams({
    view: inbox ? "inbox" : "mine",
    sort: oldestFirst ? "oldest" : "newest",
    status: status ?? "",
    severity: severity ?? "",
    before: String(nextCursor ?? ""),
  });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          {inbox ? t("Triage inbox") : t("My reports")}
        </h1>
        {!inbox && (
          <Link
            className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action"
            href="/programs?eligible=1#program-list"
          >
            {t("New report")}
          </Link>
        )}
      </div>
      {canTriage && (
        <nav
          aria-label={t("Report views")}
          className="mt-5 flex gap-5 border-b border-line text-sm"
        >
          <Link
            href="/reports"
            aria-current={!inbox ? "page" : undefined}
            className="border-b-2 border-transparent pb-2 text-muted aria-[current=page]:border-accent aria-[current=page]:text-foreground"
          >
            {t("My reports")}
          </Link>
          <Link
            href="/reports?view=inbox"
            aria-current={inbox ? "page" : undefined}
            className="border-b-2 border-transparent pb-2 text-muted aria-[current=page]:border-accent aria-[current=page]:text-foreground"
          >
            {t("Triage inbox")}
          </Link>
        </nav>
      )}
      <form className="mt-6 flex flex-wrap items-end gap-3">
        {inbox && <input type="hidden" name="view" value="inbox" />}
        <Field label={t("Status")}>
          <select className={input} name="status" defaultValue={status ?? ""}>
            <option value="">{t("All statuses")}</option>
            {statuses.map((state) => (
              <option key={state} value={state}>
                {t(state.replaceAll("_", " "))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Severity")}>
          <select
            className={input}
            name="severity"
            defaultValue={severity ?? ""}
          >
            <option value="">{t("All severities")}</option>
            {severities.map((level) => (
              <option key={level} value={level}>
                {t(level)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Sort")}>
          <select
            className={input}
            name="sort"
            defaultValue={oldestFirst ? "oldest" : "newest"}
          >
            <option value="newest">{t("Newest first")}</option>
            <option value="oldest">{t("Oldest first")}</option>
          </select>
        </Field>
        <Button>{t("Apply filters")}</Button>
      </form>
      <div
        className="mt-6 max-w-full overflow-x-auto rounded-xl border border-line bg-surface"
        role="region"
        aria-label={inbox ? t("Triage inbox") : t("My reports")}
        tabIndex={rows.length ? 0 : undefined}
      >
        {rows.length ? (
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="border-b border-line bg-subtle text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("Report")}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("Program")}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("Severity")}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("Status")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((report) => (
                <tr key={report.id} className="hover:bg-subtle/50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/reports/${report.id}`}
                      className="font-medium"
                    >
                      <span className="mr-2 whitespace-nowrap font-mono text-xs text-muted">
                        BSO-{report.number}
                      </span>
                      {report.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{report.program ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <ReportBadge severity={report.severity}>
                      {t(report.severity)}
                    </ReportBadge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <ReportBadge status={report.status}>
                      {t(report.status.replaceAll("_", " "))}
                    </ReportBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : !inbox && !status && !severity && !query.before ? (
          <div className="grid justify-items-center gap-3 p-10 text-center">
            <h2 className="font-semibold">{t("Submit your first report")}</h2>
            <p className="text-sm text-muted">
              {t("Choose a program to report a vulnerability.")}
            </p>
            <Link
              className="font-medium text-accent underline"
              href="/programs?eligible=1#program-list"
            >
              {t("Choose a program")}
            </Link>
          </div>
        ) : (
          <p className="p-5 text-sm text-muted">
            {t("No reports match these filters.")}
          </p>
        )}
      </div>
      {nextCursor !== null && (
        <Link className="mt-4 inline-block underline" href={`/reports?${next}`}>
          {t("Next page")}
        </Link>
      )}
    </>
  );
}
