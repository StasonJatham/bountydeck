import Link from "next/link";
import { ArrowUpRight, FileText, Medal, Trophy } from "lucide-react";
import { and, desc, eq, sql } from "drizzle-orm";
import { withActor } from "../../../db";
import { getResearcherProgress } from "../../../db/progress";
import { programs, reports } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { panel } from "../../../lib/forms";

export default async function Dashboard() {
  const actor = await requireActor();
  const [progress, { recent, available }] = await Promise.all([
    getResearcherProgress(actor),
    withActor(actor, async (tx) => ({
      recent: await tx
        .select({
          id: reports.id,
          number: reports.number,
          title: reports.title,
          status: reports.status,
        })
        .from(reports)
        .where(eq(reports.reporterId, actor))
        .orderBy(desc(reports.number))
        .limit(5),
      available: await tx
        .select({
          id: programs.id,
          name: programs.name,
          description: programs.description,
        })
        .from(programs)
        .where(
          and(
            eq(programs.status, "published"),
            sql`app_can_submit(${programs.id})`,
          ),
        )
        .orderBy(programs.name)
        .limit(4),
    })),
  ]);
  const standing = progress.seasons.find(
    (season) => season.period === "quarter" && season.ends_at > new Date(),
  )?.standing;
  const metrics = [
    {
      label: "Total points",
      value: progress.points,
      Icon: Medal,
      href: "/profile",
    },
    {
      label: "Validated findings",
      value: progress.validated,
      Icon: FileText,
      href: "/reports",
    },
    {
      label: "Quarterly rank",
      value: standing ? `#${standing}` : "Unranked",
      Icon: Trophy,
      href: "/leaderboard?period=quarter",
    },
  ];
  return (
    <div className="space-y-7">
      <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {metrics.map(({ label, value, Icon, href }) => (
          <Link key={label} className={`${panel} group block`} href={href}>
            <div className="flex items-center justify-between gap-3 text-sm text-neutral-600">
              <span>{label}</span>
              <Icon aria-hidden size={17} />
            </div>
            <strong className="mt-3 block text-3xl tracking-tight">
              {value}
            </strong>
          </Link>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
        <section className={panel}>
          <header className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Recent reports</h2>
            <Link className="flex items-center gap-1 text-sm" href="/reports">
              All reports <ArrowUpRight size={14} aria-hidden />
            </Link>
          </header>
          <ul className="mt-3 divide-y divide-neutral-200">
            {recent.map((report) => (
              <li key={report.id}>
                <Link
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  href={`/reports/${report.id}`}
                >
                  <span className="min-w-0 break-words">
                    <span className="mr-2 text-neutral-600">
                      BSO-{report.number}
                    </span>
                    {report.title}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs capitalize">
                    {report.status.replaceAll("_", " ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!recent.length && (
            <p className="mt-3 text-sm text-neutral-600">
              You haven’t submitted a report yet.
            </p>
          )}
        </section>
        <section className={panel}>
          <header className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Available programs</h2>
            <Link className="flex items-center gap-1 text-sm" href="/programs">
              Browse <ArrowUpRight size={14} aria-hidden />
            </Link>
          </header>
          <ul className="mt-3 divide-y divide-neutral-200">
            {available.map((program) => (
              <li key={program.id} className="py-3">
                <Link
                  className="text-sm font-medium"
                  href={`/programs/${program.id}`}
                >
                  {program.name}
                </Link>
                <p className="mt-1 line-clamp-2 text-sm text-neutral-600">
                  {program.description}
                </p>
              </li>
            ))}
          </ul>
          {!available.length && (
            <p className="mt-3 text-sm text-neutral-600">
              There are no open programs for your account.
            </p>
          )}
        </section>
      </div>
      <section className={panel}>
        <h2 className="text-lg font-semibold">Achievements</h2>
        {progress.achievements.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {progress.achievements.map((achievement) => (
              <li
                className="rounded-full bg-neutral-100 px-3 py-1 text-sm"
                key={achievement}
              >
                {achievement}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-neutral-600">
            Your first validated finding unlocks an achievement.
          </p>
        )}
      </section>
    </div>
  );
}
