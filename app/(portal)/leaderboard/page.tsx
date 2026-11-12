import { getI18n } from "../../../lib/i18n";
import { Button } from "../../../components/ui/button";
import { Award } from "lucide-react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withActor } from "../../../db";
import { getLeaderboard } from "../../../db/rankings";
import { orgUnits, platformSettings, programs } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { Field, input } from "../../../lib/forms";

export default async function Leaderboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { t, number } = await getI18n();
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
  const [rows, { selections, settings }] = await Promise.all([
    getLeaderboard(
      actor,
      match ? (match[1] as "organization" | "program") : "global",
      match?.[2] ?? null,
      period,
      points && after ? { points, userId: after } : undefined,
    ),
    withActor(actor, async (tx) => {
      const [settings] = await tx
        .select({ globalLeaderboard: platformSettings.globalLeaderboard })
        .from(platformSettings);
      const selections = await tx
        .select({
          id: programs.id,
          name: programs.name,
          orgId: orgUnits.id,
          org: orgUnits.name,
        })
        .from(programs)
        .innerJoin(orgUnits, eq(programs.orgId, orgUnits.id))
        .orderBy(orgUnits.name, programs.name);
      return { selections, settings };
    }),
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
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("Leaderboard")}
      </h1>
      <form className="mt-6 flex flex-wrap items-end gap-3">
        <Field label={t("Scope")}>
          <select className={input} name="scope" defaultValue={scope}>
            <option value="global">
              {settings.globalLeaderboard
                ? t("Global")
                : t("Global (disabled)")}
            </option>
            <optgroup label={t("Organizations")}>
              {Array.from(organizations, ([id, name]) => (
                <option key={id} value={`organization:${id}`}>
                  {name}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("Programs")}>
              {selections.map((item) => (
                <option key={item.id} value={`program:${item.id}`}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label={t("Period")}>
          <select className={input} name="period" defaultValue={period}>
            <option value="all">{t("All time")}</option>
            <option value="quarter">{t("This quarter")}</option>
            <option value="year">{t("This year")}</option>
          </select>
        </Field>
        <Button>{t("Apply")}</Button>
      </form>
      <div
        className="mt-6 max-w-full overflow-x-auto rounded-xl border border-line bg-surface"
        role="region"
        aria-label={t("Leaderboard")}
        tabIndex={rows.length ? 0 : undefined}
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-subtle text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t("Rank")}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t("Researcher")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t("Points")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row) => (
              <tr
                key={row.user_id}
                className={`border-b border-line last:border-0 ${row.is_self ? "bg-accent/5" : "hover:bg-subtle/50"}`}
              >
                <td className="w-24 px-4 py-2.5">
                  <span className="inline-flex min-w-8 items-center justify-center gap-1 rounded-md bg-subtle px-1.5 py-1 font-mono text-xs">
                    {row.standing === "1" && (
                      <Award size={13} aria-hidden className="text-warning" />
                    )}
                    {number(row.standing)}
                  </span>
                </td>
                <td className="break-words px-4 py-2.5 font-medium">
                  {row.label}
                  {row.is_self && (
                    <span className="text-xs font-normal text-muted">
                      {t(" (you)")}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-medium">
                  {number(row.points)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-5 text-sm text-muted">
            {scope === "global" && !settings.globalLeaderboard
              ? t("The platform administrator has disabled global rankings.")
              : t("No visible rankings for this selection.")}
          </p>
        )}
      </div>
      {rows.length > 100 && next && (
        <Link
          className="mt-4 inline-block underline"
          href={`/leaderboard?${next}`}
        >
          {t("Next page")}
        </Link>
      )}
    </>
  );
}
