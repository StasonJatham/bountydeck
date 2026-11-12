import Image from "next/image";
import { UserRound } from "lucide-react";
import { getI18n } from "../../../lib/i18n";
import { Button } from "../../../components/ui/button";
import { getResearcherProgress } from "../../../db/progress";
import { desc, eq } from "drizzle-orm";
import { withActor } from "../../../db";
import { profileAvatars, scoreEvents, users } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { Field, input, panel } from "../../../lib/forms";
import {
  removeAvatar,
  updateProfile,
  uploadAvatar,
} from "../../../lib/profile-actions";

export default async function Profile({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { t, date, number } = await getI18n();
  const actor = await requireActor();
  const { profile, ledger, avatarVersion } = await withActor(
    actor,
    async (tx) => {
      const [profile] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actor));
      const ledger = await tx
        .select()
        .from(scoreEvents)
        .where(eq(scoreEvents.userId, actor))
        .orderBy(desc(scoreEvents.createdAt))
        .limit(100);
      const [avatar] = await tx
        .select({ updatedAt: profileAvatars.updatedAt })
        .from(profileAvatars)
        .where(eq(profileAvatars.userId, actor));
      return { profile, ledger, avatarVersion: avatar?.updatedAt.getTime() };
    },
  );
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
        <section className={`${panel} grid gap-4`}>
          <h2 className="font-semibold">{t("Profile picture")}</h2>
          {avatarVersion && (
            <div className="relative grid size-24 place-items-center overflow-hidden rounded-full bg-subtle">
              <UserRound aria-hidden className="hidden motion-reduce:block" />
              <Image
                unoptimized
                src={`/api/profile/avatar?v=${avatarVersion}`}
                width={96}
                height={96}
                alt={t("Profile picture")}
                className="size-24 object-cover motion-reduce:hidden"
              />
            </div>
          )}
          {error === "avatar" && (
            <p role="alert" className="text-sm text-danger">
              {t(
                "This image could not be uploaded. Check the file and its limits.",
              )}
            </p>
          )}
          <form action={uploadAvatar} className="grid gap-3">
            <Field label={t("Choose a profile picture")}>
              <input
                name="avatar"
                type="file"
                accept="image/gif,image/png,image/jpeg"
                aria-describedby="avatar-limits"
                className={input}
                required
              />
            </Field>
            <p id="avatar-limits" className="text-sm text-muted">
              {t(
                "GIF, PNG, or JPEG. Up to 1 MiB, 512 × 512 pixels, and 60 frames.",
              )}
            </p>
            <Button>{t("Upload picture")}</Button>
          </form>
          {avatarVersion && (
            <form action={removeAvatar}>
              <Button>{t("Remove picture")}</Button>
            </form>
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
