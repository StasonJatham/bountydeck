import { Button } from "../../../../../components/ui/button";
import Link from "next/link";
import { and, count, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withActor } from "../../../../../db";
import {
  programs,
  programScopes,
  reports,
  rewards,
} from "../../../../../db/schema";
import { requireActor } from "../../../../../lib/actor";
import { Field, input, panel, Text } from "../../../../../lib/forms";
import {
  addReward,
  addScope,
  setProgramRole,
  updateProgram,
  updateScope,
} from "../../../../../lib/management";

export default async function Manage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { program, scopes, offers, statistics } = await withActor(
    actor,
    async (tx) => {
      const [program] = await tx
        .select()
        .from(programs)
        .where(and(eq(programs.id, id), sql`app_manages_program(${id}::uuid)`));
      if (!program) notFound();
      return {
        program,
        statistics: await tx
          .select({ status: reports.status, total: count() })
          .from(reports)
          .where(eq(reports.programId, id))
          .groupBy(reports.status),
        offers: await tx
          .select()
          .from(rewards)
          .where(eq(rewards.programId, id)),
        scopes: await tx
          .select()
          .from(programScopes)
          .where(eq(programScopes.programId, id))
          .orderBy(programScopes.name),
      };
    },
  );
  return (
    <>
      <Link href={`/programs/${id}`} className="text-sm text-neutral-600">
        ← Program
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Manage {program.name}
      </h1>
      <Link
        className="mt-3 inline-block underline"
        href={`/programs/${id}/manage/notifications`}
      >
        Notification settings
      </Link>
      {(await searchParams).error && (
        <p role="alert" className="mt-4 text-red-800">
          Check the details and try again.
        </p>
      )}
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <form
          className={`${panel} grid gap-3`}
          action={updateProgram.bind(null, id)}
        >
          <h2 className="font-semibold">Program settings</h2>
          {(
            [
              ["name", "Name"],
              ["slug", "Slug"],
            ] as const
          ).map(([key, label]) => (
            <Field label={label} key={key}>
              <input
                required
                name={key}
                defaultValue={program[key]}
                className={input}
                maxLength={100}
              />
            </Field>
          ))}
          {(
            [
              ["description", "Description"],
              ["rules", "Testing rules"],
              ["disclosurePolicy", "Disclosure policy"],
            ] as const
          ).map(([key, label]) => (
            <Field label={label} key={key}>
              <textarea
                name={key}
                defaultValue={program[key]}
                className={input}
                maxLength={10000}
                rows={4}
              />
            </Field>
          ))}
          {(
            [
              [
                "status",
                "Status",
                ["draft", "published", "paused", "archived"],
              ],
              [
                "eligibility",
                "Eligibility",
                ["all", "organization", "invitation"],
              ],
              [
                "leaderboardVisibility",
                "Leaderboard visibility",
                ["members", "hidden"],
              ],
            ] as const
          ).map(([key, label, options]) => (
            <Field label={label} key={key}>
              <select name={key} className={input} defaultValue={program[key]}>
                {options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </Field>
          ))}
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-2 text-sm font-medium">
              Points per validated finding
            </legend>
            {(["low", "medium", "high", "critical"] as const).map(
              (severity) => (
                <Field label={severity} key={severity}>
                  <input
                    type="number"
                    name={severity}
                    className={input}
                    defaultValue={program.scoring[severity]}
                    min={0}
                    max={99999}
                    required
                  />
                </Field>
              ),
            )}
          </fieldset>
          <Button>Save settings</Button>
        </form>
        <div className="grid gap-4">
          <form
            className={`${panel} grid gap-3`}
            action={addReward.bind(null, id)}
          >
            <h2 className="font-semibold">Rewards</h2>
            <ul className="space-y-1 text-sm">
              {offers.map((reward) => (
                <li key={reward.id}>
                  {reward.name} · {reward.minimumPoints} points
                </li>
              ))}
            </ul>
            <Text name="name" label="Reward name" max={100} />
            <Text
              name="description"
              label="Description"
              multiline
              required={false}
            />
            <Field label="Minimum points">
              <input
                type="number"
                name="minimumPoints"
                min={0}
                max={999999}
                className={input}
                required
              />
            </Field>
            <Button>Add reward</Button>
          </form>
          <section className={panel}>
            <h2 className="font-semibold">Report activity</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {statistics.map((row) => (
                <li className="capitalize" key={row.status}>
                  {row.status.replaceAll("_", " ")} · {row.total}
                </li>
              ))}
            </ul>
            {!statistics.length && (
              <p className="mt-2 text-sm">No reports yet.</p>
            )}
          </section>
          <section className={panel}>
            <h2 className="font-semibold">Scope</h2>
            <div className="mt-2 divide-y divide-neutral-200">
              {scopes.map((item) => (
                <details key={item.id} className="py-2">
                  <summary className="cursor-pointer text-sm">
                    {item.name} · {item.inScope ? "In scope" : "Out of scope"}
                  </summary>
                  <form
                    className="mt-3 grid gap-3"
                    action={updateScope.bind(null, id, item.id)}
                  >
                    <Field label="Asset name">
                      <input
                        className={input}
                        name="name"
                        defaultValue={item.name}
                        required
                        maxLength={100}
                      />
                    </Field>
                    <Field label="Description">
                      <textarea
                        className={input}
                        name="description"
                        defaultValue={item.description}
                        maxLength={10000}
                      />
                    </Field>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="inScope"
                        defaultChecked={item.inScope}
                      />{" "}
                      In scope
                    </label>
                    <Button>Save asset</Button>
                  </form>
                </details>
              ))}
            </div>
          </section>
          <form
            className={`${panel} grid gap-3`}
            action={addScope.bind(null, id)}
          >
            <h2 className="font-semibold">Add to scope</h2>
            <Text name="name" label="Asset name" max={100} />
            <Text
              name="description"
              label="Description"
              multiline
              required={false}
            />
            <label className="flex gap-2 text-sm">
              <input type="checkbox" name="inScope" defaultChecked /> In scope
            </label>
            <Button>Add asset</Button>
          </form>
          <form
            className={`${panel} grid gap-3`}
            action={setProgramRole.bind(null, id)}
          >
            <h2 className="font-semibold">Program access</h2>
            <Text name="userId" label="User ID" max={36} />
            <Field label="Role">
              <select name="role" className={input}>
                <option>researcher</option>
                <option>triager</option>
                <option>manager</option>
              </select>
            </Field>
            <div className="flex gap-2">
              <Button name="change" value="grant">
                Grant
              </Button>
              <Button name="change" value="revoke">
                Revoke
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
