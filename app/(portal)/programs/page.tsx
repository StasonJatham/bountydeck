import { getI18n } from "../../../lib/i18n";
import Link from "next/link";
import { ArrowUpRight, Building2 } from "lucide-react";
import { z } from "zod";
import { ReportBadge } from "../../../components/report-badge";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { requireActor } from "../../../lib/actor";
import { withActor } from "../../../db";
import { orgUnits, programs, programScopes } from "../../../db/schema";

export default async function Programs({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    eligible?: string;
    organization?: string;
  }>;
}) {
  const { t, number } = await getI18n();
  const actor = await requireActor();
  const filters = await searchParams;
  const query = filters.q;
  const status = (["draft", "published", "paused", "archived"] as const).find(
    (state) => state === filters.status,
  );
  const eligible = filters.eligible === "1";
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  const selectedOrganization = z.uuid().safeParse(filters.organization).data;
  const { rows, admin } = await withActor(actor, async (tx) => ({
    admin: (
      await tx.execute<{ admin: boolean }>(
        sql`select app_platform_admin() as admin`,
      )
    ).rows[0].admin,
    rows: await tx
      .select({
        program: programs,
        organization: orgUnits.name,
        scopeCount: sql<number>`(select count(*)::int from ${programScopes} where ${programScopes.programId} = ${programs.id} and ${programScopes.inScope})`,
        eligible: sql<boolean>`app_can_submit(${programs.id})`,
      })
      .from(programs)
      .innerJoin(orgUnits, eq(programs.orgId, orgUnits.id))
      .where(
        and(
          q
            ? or(ilike(programs.name, `%${q}%`), ilike(orgUnits.name, `%${q}%`))
            : undefined,
          selectedOrganization
            ? eq(programs.orgId, selectedOrganization)
            : undefined,
          status && eq(programs.status, status),
          eligible
            ? sql`app_can_submit(${programs.id}) AND EXISTS (
            SELECT FROM ${programScopes} WHERE ${programScopes.programId} = ${programs.id} AND ${programScopes.inScope}
          )`
            : undefined,
        ),
      )
      .orderBy(asc(programs.name), asc(programs.id))
      .limit(100),
  }));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t(eligible ? "Choose a program" : "Programs")}
        </h1>
        {admin && (
          <Link
            className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action"
            href="/admin#create-program"
          >
            {t("Create program")}
          </Link>
        )}
      </div>
      <form className="mt-6 flex flex-wrap gap-2">
        {selectedOrganization && (
          <input
            type="hidden"
            name="organization"
            value={selectedOrganization}
          />
        )}
        <label className="sr-only" htmlFor="program-search">
          {t("Search programs")}
        </label>
        <input
          id="program-search"
          className="min-w-0 grow basis-48 rounded-md border border-control bg-surface px-3 py-2"
          name="q"
          defaultValue={q}
          placeholder={t("Search programs")}
        />
        <select
          aria-label={t("Program status")}
          className="rounded-md border border-control bg-surface px-3 py-2"
          name="status"
          defaultValue={status ?? ""}
        >
          <option value="">{t("All statuses")}</option>
          <option value="published">{t("published")}</option>
          <option value="paused">{t("paused")}</option>
          <option value="draft">{t("draft")}</option>
          <option value="archived">{t("archived")}</option>
        </select>
        <label className="flex items-center gap-2 px-2 text-sm">
          <input
            type="checkbox"
            name="eligible"
            value="1"
            defaultChecked={eligible}
          />{" "}
          {t("Eligible for submission")}
        </label>
        <button className="rounded-md bg-action px-4 py-2 text-on-action">
          {t("Search")}
        </button>
      </form>
      <div
        id="program-list"
        className="mt-6 grid scroll-mt-20 gap-4 md:grid-cols-2"
      >
        {rows.map(({ program, organization, eligible, scopeCount }) => (
          <Link
            className="group flex min-w-0 flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent/40 hover:no-underline"
            key={program.id}
            href={`/programs/${program.id}${filters.eligible === "1" ? "#submit-report" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Building2 size={14} aria-hidden />
                {organization}
              </span>
              <ReportBadge status={program.status}>
                {t(program.status)}
              </ReportBadge>
            </div>
            <h2 className="mt-3 flex items-center justify-between gap-3 break-words text-lg font-semibold">
              <span className="min-w-0">{program.name}</span>
              <ArrowUpRight
                className="shrink-0 text-muted group-hover:text-accent"
                size={16}
                aria-hidden
              />
            </h2>
            <p className="mt-1 line-clamp-3 text-sm text-secondary">
              {program.description}
            </p>
            {(scopeCount > 0 || eligible) && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-muted">
                {scopeCount > 0 && (
                  <span>
                    {t(
                      scopeCount === 1
                        ? "{count} in-scope asset"
                        : "{count} in-scope assets",
                      { count: number(scopeCount) },
                    )}
                  </span>
                )}
                {eligible && <span>{t("Eligible for submission")}</span>}
              </div>
            )}
          </Link>
        ))}
      </div>
      {!rows.length && (
        <p className="mt-6 text-muted">{t("No programs found.")}</p>
      )}
    </>
  );
}
