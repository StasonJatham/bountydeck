import { Button } from "../../../components/ui/button";
import { getResearcherProgress } from "../../../db/progress";
import { desc, eq } from "drizzle-orm";
import { withActor } from "../../../db";
import { scoreEvents, users } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { Field, input, panel } from "../../../lib/forms";
import { updateProfile } from "../../../lib/profile-actions";

export default async function Profile() {
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
        Researcher profile
      </h1>
      <div className="mt-6 grid items-start gap-4 md:grid-cols-2">
        <section className={panel}>
          <h2 className="font-semibold">Achievements</h2>
          <p className="mt-2 text-sm">
            {progress.points} points · {progress.validated} validated findings
          </p>
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
            <p className="mt-3 text-sm text-neutral-600">
              No achievements earned yet.
            </p>
          )}
        </section>
        <section className={panel}>
          <h2 className="font-semibold">Program recognition</h2>
          <ul className="mt-2 space-y-3 text-sm">
            {progress.programs.map((program) => (
              <li key={program.program_id}>
                <strong>{program.name}</strong> · {program.points} points
                {program.earned_rewards.length > 0 && (
                  <p>{program.earned_rewards.join(", ")}</p>
                )}
              </li>
            ))}
          </ul>
          {!progress.programs.length && (
            <p className="mt-2 text-sm">No program activity yet.</p>
          )}
        </section>
        <section className={panel}>
          <h2 className="font-semibold">Season history</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {progress.seasons.map((season) => (
              <li
                key={`${season.period}-${season.starts_at.toISOString()}`}
                className="capitalize"
              >
                {season.period} starting{" "}
                {season.starts_at.toISOString().slice(0, 10)} · {season.points}{" "}
                points{season.standing && ` · Rank ${season.standing}`}
              </li>
            ))}
          </ul>
          {!progress.seasons.length && (
            <p className="mt-2 text-sm">No seasonal activity yet.</p>
          )}
        </section>
        <form className={`${panel} grid gap-4`} action={updateProfile}>
          <h2 className="font-semibold">
            {profile.name ?? "Profile settings"}
          </h2>
          <p className="break-all text-sm text-neutral-600">User ID {actor}</p>
          <Field label="Leaderboard pseudonym">
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
            Show my ranking to other eligible researchers
          </label>
          <Button>Save profile</Button>
        </form>
        <section className={panel}>
          <h2 className="font-semibold">Recent points activity</h2>
          <ul className="mt-2 divide-y divide-neutral-200">
            {ledger.map((event) => (
              <li
                className="flex justify-between gap-4 py-2 text-sm"
                key={event.id}
              >
                <span>{event.reason}</span>
                <strong>
                  {event.points > 0 ? "+" : ""}
                  {event.points}
                </strong>
              </li>
            ))}
          </ul>
          {!ledger.length && (
            <p className="mt-2 text-sm">No points awarded yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
