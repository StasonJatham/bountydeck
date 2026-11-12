import Link from "next/link";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { requireActor } from "../../../lib/actor";
import { withActor } from "../../../db";
import { orgUnits, programs } from "../../../db/schema";

export default async function Programs({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; eligible?: string }>;
}) {
  const actor = await requireActor();
  const filters = await searchParams;
  const query = filters.q;
  const status = (["draft", "published", "paused", "archived"] as const).find(
    (state) => state === filters.status,
  );
  const eligible = filters.eligible === "1";
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  const rows = await withActor(actor, (tx) =>
    tx
      .select({
        program: programs,
        organization: orgUnits.name,
        eligible: sql<boolean>`app_can_submit(${programs.id})`,
      })
      .from(programs)
      .innerJoin(orgUnits, eq(programs.orgId, orgUnits.id))
      .where(
        and(
          q
            ? or(ilike(programs.name, `%${q}%`), ilike(orgUnits.name, `%${q}%`))
            : undefined,
          status && eq(programs.status, status),
          eligible ? sql`app_can_submit(${programs.id})` : undefined,
        ),
      )
      .orderBy(asc(programs.name), asc(programs.id))
      .limit(100),
  );
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Programs</h1>
      <form className="mt-6 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="program-search">
          Search programs
        </label>
        <input
          id="program-search"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2"
          name="q"
          defaultValue={q}
          placeholder="Search programs"
        />
        <select
          aria-label="Program status"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2"
          name="status"
          defaultValue={status ?? ""}
        >
          <option value="">All statuses</option>
          <option>published</option>
          <option>paused</option>
          <option>draft</option>
          <option>archived</option>
        </select>
        <label className="flex items-center gap-2 px-2 text-sm">
          <input
            type="checkbox"
            name="eligible"
            value="1"
            defaultChecked={eligible}
          />{" "}
          Eligible for submission
        </label>
        <button className="rounded-md bg-neutral-900 px-4 py-2 text-white">
          Search
        </button>
      </form>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {rows.map(({ program, organization, eligible }) => (
          <Link
            className="rounded-lg border border-neutral-200 bg-white p-5"
            key={program.id}
            href={`/programs/${program.id}`}
          >
            <p className="text-sm text-neutral-600">
              {organization} · {program.status}
              {eligible ? " · Eligible" : ""}
            </p>
            <h2 className="mt-2 text-lg font-semibold">{program.name}</h2>
            <p className="mt-2 line-clamp-3 text-sm text-neutral-700">
              {program.description}
            </p>
          </Link>
        ))}
      </div>
      {!rows.length && (
        <p className="mt-6 text-neutral-600">No programs found.</p>
      )}
    </>
  );
}
