import {
  AchievementNotice,
  AchievementPreview,
} from "../../../components/achievement-preview";
import { getAchievements } from "../../../lib/achievements";
import { getI18n } from "../../../lib/i18n";
import { ReportBadge } from "../../../components/report-badge";
import Link from "next/link";
import { ArrowUpRight, FileText, Medal, Trophy } from "lucide-react";
import { and, desc, eq, sql } from "drizzle-orm";
import { withActor } from "../../../db";
import { getResearcherProgress } from "../../../db/progress";
import { programs, reports } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { panel } from "../../../lib/forms";

export default async function Dashboard() {
  const { t, number } = await getI18n();
  const actor = await requireActor();
  const [progress, { awards }, { recent, available }] = await Promise.all([
    getResearcherProgress(actor),
    getAchievements(actor),
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
      value: number(progress.points),
      Icon: Medal,
      href: "/profile",
    },
    {
      label: "Validated findings",
      value: number(progress.validated),
      Icon: FileText,
      href: "/reports",
    },
    {
      label: "Quarterly rank",
      value: standing ? `#${number(standing)}` : t("Unranked"),
      Icon: Trophy,
      href: "/leaderboard?period=quarter",
    },
  ];
  return (
    <div className="space-y-7">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("Dashboard")}
      </h1>
      <AchievementNotice awards={awards} />
      <div className="grid gap-3 sm:grid-cols-3">
        {metrics.map(({ label, value, Icon, href }) => (
          <Link
            key={label}
            className={`${panel} block transition-colors hover:border-accent/40 hover:no-underline`}
            href={href}
          >
            <div className="flex items-center justify-between gap-3 text-sm text-muted">
              <span>{t(label)}</span>
              <span className="rounded-md bg-accent/10 p-1.5 text-accent">
                <Icon aria-hidden size={16} />
              </span>
            </div>
            <strong className="mt-2 block font-mono text-3xl font-medium tracking-tight">
              {value}
            </strong>
          </Link>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
        <section className={panel}>
          <header className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{t("Recent reports")}</h2>
            <Link className="flex items-center gap-1 text-sm" href="/reports">
              {t("All reports")} <ArrowUpRight size={14} aria-hidden />
            </Link>
          </header>
          <ul className="mt-3 divide-y divide-line">
            {recent.map((report) => (
              <li key={report.id}>
                <Link
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  href={`/reports/${report.id}`}
                >
                  <span className="min-w-0 break-words">
                    <span className="mr-2 whitespace-nowrap font-mono text-xs text-muted">
                      BSO-{report.number}
                    </span>
                    {report.title}
                  </span>
                  <ReportBadge status={report.status}>
                    {t(report.status.replaceAll("_", " "))}
                  </ReportBadge>
                </Link>
              </li>
            ))}
          </ul>
          {!recent.length && (
            <p className="mt-3 text-sm text-muted">
              {t("You haven’t submitted a report yet.")}
            </p>
          )}
        </section>
        <section className={panel}>
          <header className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{t("Available programs")}</h2>
            <Link className="flex items-center gap-1 text-sm" href="/programs">
              {t("Browse")} <ArrowUpRight size={14} aria-hidden />
            </Link>
          </header>
          <ul className="mt-3 divide-y divide-line">
            {available.map((program) => (
              <li key={program.id} className="py-3">
                <Link
                  className="text-sm font-medium"
                  href={`/programs/${program.id}`}
                >
                  {program.name}
                </Link>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {program.description}
                </p>
              </li>
            ))}
          </ul>
          {!available.length && (
            <p className="mt-3 text-sm text-muted">
              {t("There are no open programs for your account.")}
            </p>
          )}
        </section>
      </div>
      <AchievementPreview awards={awards} compact />
    </div>
  );
}
