import Image from "next/image";
import { LockKeyhole, Medal } from "lucide-react";
import { AchievementDialog } from "../../../components/achievement-dialog";
import { AchievementNotice } from "../../../components/achievement-preview";
import { Button } from "../../../components/ui/button";
import { getAchievements } from "../../../lib/achievements";
import catalog from "../../../lib/achievements/catalog.json";
import { requireActor } from "../../../lib/actor";
import { Field, input, panel } from "../../../lib/forms";
import { getI18n } from "../../../lib/i18n";
import { saveFeatured } from "./actions";

const categories = [...new Set(catalog.badges.map(({ category }) => category))];
const tierStyles: Record<string, string> = {
  starter: "border-control text-secondary",
  bronze: "border-warning/30 text-warning",
  silver: "border-control bg-subtle text-secondary",
  gold: "border-warning/45 bg-warning/10 text-warning",
  legendary: "border-accent/40 bg-accent/10 text-accent",
};

export default async function Achievements({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    status?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  const { t, date, number } = await getI18n();
  const actor = await requireActor();
  const query = await searchParams;
  const category =
    query.category && categories.includes(query.category) ? query.category : "";
  const status =
    query.status === "earned" || query.status === "locked" ? query.status : "";
  const { awards, progress } = await getAchievements(actor);
  const earned = new Set(awards.map(({ id }) => id));
  const featured = new Set(
    awards.filter((award) => award.featured).map(({ id }) => id),
  );
  const visible = catalog.badges.filter(
    (badge) =>
      (!category || badge.category === category) &&
      (!status || (status === "earned") === earned.has(badge.id)),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("Achievements")}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {t("{earned} of {total} badges earned", {
            earned: number(earned.size),
            total: number(catalog.badges.length),
          })}
        </p>
      </header>
      <AchievementNotice awards={awards} />
      <form className="flex flex-wrap items-end gap-3">
        <Field label={t("Category")}>
          <select name="category" className={input} defaultValue={category}>
            <option value="">{t("All categories")}</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {t(item)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Status")}>
          <select name="status" className={input} defaultValue={status}>
            <option value="">{t("All badges")}</option>
            <option value="earned">{t("Earned")}</option>
            <option value="locked">{t("Locked")}</option>
          </select>
        </Field>
        <Button variant="outline">{t("Apply")}</Button>
      </form>
      {visible.length ? (
        <ul
          role="list"
          aria-label={t("Badge collection")}
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {visible.map((badge) => {
            const dates = awards.filter(({ id }) => id === badge.id);
            const isEarned = dates.length > 0;
            const target = badge.rule.threshold;
            const current = progress[badge.id] ?? 0;
            const description = t(badge.description);
            const title = t(badge.name);
            const tier = t(badge.tier);
            const asset = `/achievements/${badge.asset}`;
            return (
              <li
                key={badge.id}
                className={`${panel} flex min-w-0 flex-col gap-3 motion-safe:transition-colors hover:border-accent/40`}
              >
                <div className="flex items-center gap-3">
                  <Image
                    src={asset}
                    width={64}
                    height={64}
                    alt=""
                    unoptimized
                    className={`shrink-0 ${isEarned ? "" : "opacity-60 grayscale"}`}
                  />
                  <div className="min-w-0">
                    <h2 className="break-words font-semibold">{title}</h2>
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs capitalize ${tierStyles[badge.tier]}`}
                    >
                      {tier}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-secondary">{description}</p>
                {target !== undefined && !isEarned && (
                  <div className="grid gap-1">
                    <progress
                      className="h-2 w-full accent-action"
                      aria-label={t("Progress toward {badge}", {
                        badge: title,
                      })}
                      value={Math.min(target, Math.max(0, current))}
                      max={target}
                    />
                    <p className="font-mono text-xs text-muted">
                      {number(current)} / {number(target)}
                    </p>
                  </div>
                )}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {isEarned ? (
                      <Medal aria-hidden size={14} />
                    ) : (
                      <LockKeyhole aria-hidden size={14} />
                    )}
                    {t(isEarned ? "Earned" : "Locked")}
                  </span>
                  <AchievementDialog
                    title={title}
                    label={t("Details")}
                    close={t("Close")}
                    accessibleLabel={t("Details for {badge}", { badge: title })}
                  >
                    <Image
                      src={asset}
                      width={128}
                      height={128}
                      alt=""
                      unoptimized
                      className={`mx-auto my-4 ${isEarned ? "" : "opacity-60 grayscale"}`}
                    />
                    <p className="text-sm">{description}</p>
                    <dl className="mt-4 grid gap-3 text-sm">
                      <div>
                        <dt className="font-semibold">{t("Tier")}</dt>
                        <dd className="capitalize">{tier}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold">
                          {t("Unlock criteria")}
                        </dt>
                        <dd>{unlockCriteria(badge, t, number)}</dd>
                      </div>
                      {isEarned && (
                        <div>
                          <dt className="font-semibold">{t("Earned on")}</dt>
                          {dates.map(({ awardId, earnedAt, season }) => (
                            <dd key={awardId}>
                              <time dateTime={earnedAt.toISOString()}>
                                {date(earnedAt)}
                              </time>
                              {season && ` · ${seasonLabel(season, t, number)}`}
                            </dd>
                          ))}
                        </div>
                      )}
                    </dl>
                  </AchievementDialog>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          {t("No badges match these filters.")}
        </p>
      )}
      {earned.size > 0 && (
        <form
          id="featured"
          action={saveFeatured}
          className={`${panel} space-y-3`}
        >
          <h2 className="font-semibold">{t("Featured badges")}</h2>
          <fieldset>
            <legend className="mb-2 text-sm text-muted">
              {t(
                "Choose up to three earned badges to feature on your profile.",
              )}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {catalog.badges
                .filter(({ id }) => earned.has(id))
                .map((badge) => (
                  <label
                    key={badge.id}
                    className="flex min-w-0 items-center gap-2 rounded-md bg-subtle p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="featured"
                      value={badge.id}
                      defaultChecked={featured.has(badge.id)}
                    />
                    <Image
                      src={`/achievements/${badge.asset}`}
                      width={32}
                      height={32}
                      alt=""
                      unoptimized
                      className="shrink-0"
                    />
                    <span className="break-words">{t(badge.name)}</span>
                  </label>
                ))}
            </div>
          </fieldset>
          {query.error === "featured" && (
            <p role="alert" className="text-sm text-danger">
              {t("Select up to three badges you have earned.")}
            </p>
          )}
          {query.saved === "featured" && (
            <p role="status" className="text-sm text-success">
              {t("Featured badges saved.")}
            </p>
          )}
          <Button>{t("Save featured badges")}</Button>
        </form>
      )}
    </div>
  );
}

function unlockCriteria(
  badge: (typeof catalog.badges)[number],
  t: Awaited<ReturnType<typeof getI18n>>["t"],
  number: Awaited<ReturnType<typeof getI18n>>["number"],
) {
  if (badge.rule.type === "manual_award") {
    return t("A program manager must grant this recognition.");
  }
  if (badge.rule.type === "final_season_rank") {
    return t(
      badge.rule.period === "quarter"
        ? "Finish at rank {rank} or higher in a finalized quarterly season."
        : "Finish at rank {rank} or higher in a finalized annual season.",
      { rank: number(badge.rule.max_rank ?? 1) },
    );
  }
  return t(badge.description);
}

function seasonLabel(
  season: string,
  t: Awaited<ReturnType<typeof getI18n>>["t"],
  number: Awaited<ReturnType<typeof getI18n>>["number"],
) {
  const [period, startsOn] = season.split(":");
  const start = new Date(startsOn);
  const year = start.getUTCFullYear();
  return period === "quarter"
    ? t("Q{quarter} {year}", {
        quarter: number(Math.floor(start.getUTCMonth() / 3) + 1),
        year: String(year),
      })
    : String(year);
}
