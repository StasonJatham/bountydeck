import { getI18n } from "../../../lib/i18n";
import { Button } from "../../../components/ui/button";
import { getResearcherProgress } from "../../../db/progress";
import { desc, eq } from "drizzle-orm";
import { withActor } from "../../../db";
import { scoreEvents, users } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { Field, input, panel } from "../../../lib/forms";
import { updateProfile } from "../../../lib/profile-actions";

export default async function Profile() {
  const { t, date, number } = await getI18n();
  const actor = await requireActor();
  const { profile, ledger } = await withActor(actor, async (tx) => {
    const [profile] = await tx.select().from(users).where(eq(users.id, actor));
    const ledger = await tx
      .select()
      .from(scoreEvents)
      .where(eq(scoreEvents.userId, actor))
      .orderBy(desc(scoreEvents.createdAt))
      .limit(100);
    return { profile, ledger };
  });
  const progress = await getResearcherProgress(actor);
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("Researcher profile")}
      </h1>
      <div className="mt-6 grid items-start gap-4 md:grid-cols-2">
        <section className={panel}>
          <h2 className="font-semibold">{t("Achievements")}</h2>
          <p className="mt-2 text-sm">
            {number(progress.points)} {t("points ·")}{" "}
            {number(progress.validated)} {t("validated findings")}
          </p>
          {progress.achievements.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {progress.achievements.map((achievement) => (
                <li
                  className="rounded-full bg-subtle px-3 py-1 text-sm"
                  key={t(achievement)}
                >
                  {t(achievement)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">
              {t("No achievements earned yet.")}
            </p>
          )}
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Program recognition")}</h2>
          <ul className="mt-2 space-y-3 text-sm">
            {progress.programs.map((program) => (
              <li key={program.program_id}>
                <strong className="font-mono">{program.name}</strong> ·{" "}
                {number(program.points)} {t("points")}
                {program.earned_rewards.length > 0 && (
                  <p>{program.earned_rewards.join(", ")}</p>
                )}
              </li>
            ))}
          </ul>
          {!progress.programs.length && (
            <p className="mt-2 text-sm">{t("No program activity yet.")}</p>
          )}
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Season history")}</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {progress.seasons.map((season) => (
              <li
                key={`${season.period}-${season.starts_at.toISOString()}`}
                className="capitalize"
              >
                {t(season.period)} {t("starting")} {date(season.starts_at)} ·{" "}
                {number(season.points)} {t("points")}
                {season.standing &&
                  t(" · Rank {rank}", { rank: number(season.standing) })}
              </li>
            ))}
          </ul>
          {!progress.seasons.length && (
            <p className="mt-2 text-sm">{t("No seasonal activity yet.")}</p>
          )}
        </section>
        <form className={`${panel} grid gap-4`} action={updateProfile}>
          <h2 className="font-semibold">
            {profile.name ?? t("Profile settings")}
          </h2>
          <p className="break-all text-sm text-muted">
            {t("User ID")} <span className="font-mono text-xs">{actor}</span>
          </p>
          <Field label={t("Leaderboard pseudonym")}>
            <input
              name="pseudonym"
              className={input}
              defaultValue={profile.pseudonym ?? ""}
              maxLength={64}
            />
          </Field>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              name="leaderboardVisible"
              defaultChecked={profile.leaderboardVisible}
            />{" "}
            {t("Show my ranking to other eligible researchers")}
          </label>
          <Button>{t("Save profile")}</Button>
        </form>
        <section className={panel}>
          <h2 className="font-semibold">{t("Recent points activity")}</h2>
          <ul className="mt-2 divide-y divide-line">
            {ledger.map((event) => (
              <li
                className="flex justify-between gap-4 py-2 text-sm"
                key={event.id}
              >
                <span>
                  {event.kind === "award" ? t(event.reason) : event.reason}
                </span>
                <strong className="font-mono">
                  {event.points > 0 ? "+" : ""}
                  {number(event.points)}
                </strong>
              </li>
            ))}
          </ul>
          {!ledger.length && (
            <p className="mt-2 text-sm">{t("No points awarded yet.")}</p>
          )}
        </section>
      </div>
    </>
  );
}
