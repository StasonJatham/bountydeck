import Image from "next/image";
import Link from "next/link";
import { Award } from "lucide-react";
import { dismissAchievementNotice } from "../app/(portal)/achievements/actions";
import type { getAchievements } from "../lib/achievements";
import catalog from "../lib/achievements/catalog.json";
import { panel } from "../lib/forms";
import { getI18n } from "../lib/i18n";
import { Button } from "./ui/button";

type Awards = Awaited<ReturnType<typeof getAchievements>>["awards"];

export async function AchievementPreview({
  awards,
  compact = false,
}: {
  awards: Awards;
  compact?: boolean;
}) {
  const { t, date } = await getI18n();
  const latest = new Map<string, Awards[number]>();
  for (const award of awards) {
    const previous = latest.get(award.id);
    if (!previous || award.earnedAt > previous.earnedAt) {
      latest.set(award.id, award);
    }
  }
  const unique = [...latest.values()].sort(
    (first, second) =>
      Number(second.featured) - Number(first.featured) ||
      second.earnedAt.getTime() - first.earnedAt.getTime(),
  );
  const badges = compact ? unique.slice(0, 3) : unique;
  const size = compact ? 32 : 64;
  return (
    <section className={panel}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("Achievements")}</h2>
        <Link className="text-sm underline" href="/achievements">
          {t("View collection")}
        </Link>
      </header>
      {badges.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {badges.map((award) => {
            const badge = catalog.badges.find(({ id }) => id === award.id);
            if (!badge) return null;
            return (
              <li
                key={award.id}
                className="flex min-w-0 items-center gap-3 rounded-md bg-subtle p-2"
              >
                <Image
                  src={`/achievements/${badge.asset}`}
                  width={size}
                  height={size}
                  alt=""
                  unoptimized
                  className="shrink-0"
                />
                <div className="min-w-0 text-sm">
                  <p className="break-words font-medium">{t(badge.name)}</p>
                  {!compact && (
                    <p className="text-xs text-muted">{date(award.earnedAt)}</p>
                  )}
                  {award.featured && (
                    <span className="text-xs text-muted">
                      {t("Featured badge")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {t("No achievements earned yet.")}
        </p>
      )}
    </section>
  );
}

export async function AchievementNotice({ awards }: { awards: Awards }) {
  const pending = awards.filter(({ seen }) => !seen).slice(0, 30);
  if (!pending.length) return null;
  const { t, number } = await getI18n();
  const names = [...new Set(pending.map(({ id }) => id))]
    .map((id) => catalog.badges.find((badge) => badge.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (!names.length) return null;

  return (
    <aside
      data-slot="toast"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-sm"
    >
      <div role="status" className="flex items-start gap-3 text-sm">
        <Award aria-hidden size={20} className="shrink-0 text-warning" />
        <div>
          <p className="font-semibold">
            {pending.length === 1
              ? t("Achievement unlocked")
              : t("{count} achievements unlocked", {
                  count: number(pending.length),
                })}
          </p>
          <p className="text-muted">
            {names.map((name) => t(name)).join(", ")}
          </p>
        </div>
      </div>
      <form
        action={dismissAchievementNotice.bind(
          null,
          pending.map(({ awardId }) => awardId),
        )}
      >
        <Button variant="outline">{t("Dismiss")}</Button>
      </form>
    </aside>
  );
}
