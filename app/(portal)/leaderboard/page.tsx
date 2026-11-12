import { Button } from "../../../components/ui/button";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withActor } from "../../../db";
import { getLeaderboard } from "../../../db/rankings";
import { orgUnits, programs } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { Field, input, panel } from "../../../lib/forms";

export default async function Leaderboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const query = await searchParams;
  const parsed = z
    .object({
      scope: z.string().default("global"),
      period: z.enum(["all", "quarter", "year"]).default("all"),
      points: z
        .string()
        .regex(/^-?\d{1,18}$/)
        .optional(),
      after: z.uuid().optional(),
    })
    .safeParse(query);
  if (!parsed.success) notFound();
  const { scope, period, points, after } = parsed.data;
  const match = /^(organization|program):(.+)$/.exec(scope);
  if (scope !== "global" && (!match || !z.uuid().safeParse(match[2]).success))
    notFound();
  const [rows, selections] = await Promise.all([
    getLeaderboard(
      actor,
      match ? (match[1] as "organization" | "program") : "global",
      match?.[2] ?? null,
      period,
      points && after ? { points, userId: after } : undefined,
    ),
    withActor(actor, (tx) =>
      tx
        .select({
          id: programs.id,
          name: programs.name,
          orgId: orgUnits.id,
          org: orgUnits.name,
        })
        .from(programs)
        .innerJoin(orgUnits, eq(programs.orgId, orgUnits.id))
        .orderBy(orgUnits.name, programs.name),
    ),
  ]);
  const organizations = new Map(
    selections.map(({ orgId, org }) => [orgId, org]),
  );
  const last = rows[99];
  const next =
    last &&
    new URLSearchParams({
      scope,
      period,
      points: last.points,
      after: last.user_id,
    });
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Leaderboard</h1>
      <form className="mt-6 flex flex-wrap items-end gap-3">
        <Field label="Scope">
          <select className={input} name="scope" defaultValue={scope}>
            <option value="global">Global</option>
            <optgroup label="Organizations">
              {Array.from(organizations, ([id, name]) => (
                <option key={id} value={`organization:${id}`}>
                  {name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Programs">
              {selections.map((item) => (
                <option key={item.id} value={`program:${item.id}`}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label="Period">
          <select className={input} name="period" defaultValue={period}>
            <option value="all">All time</option>
            <option value="quarter">This quarter</option>
            <option value="year">This year</option>
          </select>
        </Field>
        <Button>Apply</Button>
      </form>
      <div className={`${panel} mt-6 overflow-auto`}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="pb-3">Rank</th>
              <th className="pb-3">Researcher</th>
              <th className="pb-3 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row) => (
              <tr
                key={row.user_id}
                className="border-b border-neutral-200 last:border-0"
              >
                <td className="py-3">{row.standing}</td>
                <td>
                  {row.label}
                  {row.is_self && " (you)"}
                </td>
                <td className="text-right tabular-nums">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="mt-3">No visible rankings for this selection.</p>
        )}
      </div>
      {rows.length > 100 && next && (
        <Link
          className="mt-4 inline-block underline"
          href={`/leaderboard?${next}`}
        >
          Next page
        </Link>
      )}
    </>
  );
}
