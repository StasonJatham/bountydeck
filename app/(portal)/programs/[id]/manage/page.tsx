import { MarkdownEditor } from "../../../../../components/markdown-editor";
import { getI18n } from "../../../../../lib/i18n";
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
  const { t, number } = await getI18n();
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
      <Link href={`/programs/${id}`} className="text-sm text-muted">
        {t("← Program")}
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {t("Manage {name}", { name: program.name })}
      </h1>
      <Link
        className="mt-3 inline-block underline"
        href={`/programs/${id}/manage/notifications`}
      >
        {t("Notification settings")}
      </Link>
      {(await searchParams).error && (
        <p role="alert" className="mt-4 text-danger">
          {t("Check the details and try again.")}
        </p>
      )}
      <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <form
          className={`${panel} grid gap-3`}
          action={updateProgram.bind(null, id)}
        >
          <h2 className="font-semibold">{t("Program settings")}</h2>
          {(
            [
              ["name", "Name"],
              ["slug", "Slug"],
            ] as const
          ).map(([key, label]) => (
            <Field label={t(label)} key={key}>
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
            <MarkdownEditor
              key={key}
              name={key}
              initial={program[key]}
              label={t(label)}
              preview={t("Markdown preview")}
              list={t("Add list item")}
            />
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
            <Field label={t(label)} key={key}>
              <select name={key} className={input} defaultValue={program[key]}>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {t(option)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-2 text-sm font-medium">
              {t("Points per validated finding")}
            </legend>
            {(["low", "medium", "high", "critical"] as const).map(
              (severity) => (
                <Field label={t(severity)} key={severity}>
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
          <Button>{t("Save settings")}</Button>
        </form>
        <div className="grid gap-4">
          <form
            className={`${panel} grid gap-3`}
            action={addReward.bind(null, id)}
          >
            <h2 className="font-semibold">{t("Rewards")}</h2>
            <ul className="space-y-1 text-sm">
              {offers.map((reward) => (
                <li key={reward.id}>
                  {reward.name} · {number(reward.minimumPoints)} {t("points")}
                </li>
              ))}
            </ul>
            <Text name="name" label={t("Reward name")} max={100} />
            <Text
              name="description"
              label={t("Description")}
              multiline
              required={false}
            />
            <Field label={t("Minimum points")}>
              <input
                type="number"
                name="minimumPoints"
                min={0}
                max={999999}
                className={input}
                required
              />
            </Field>
            <Button>{t("Add reward")}</Button>
          </form>
          <section className={panel}>
            <h2 className="font-semibold">{t("Report activity")}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {statistics.map((row) => (
                <li className="capitalize" key={row.status}>
                  {t(row.status.replaceAll("_", " "))} · {number(row.total)}
                </li>
              ))}
            </ul>
            {!statistics.length && (
              <p className="mt-2 text-sm">{t("No reports yet.")}</p>
            )}
          </section>
          <section className={panel}>
            <h2 className="font-semibold">{t("Scope")}</h2>
            <div className="mt-2 divide-y divide-line">
              {scopes.map((item) => (
                <details key={item.id} className="py-2">
                  <summary className="cursor-pointer text-sm">
                    {item.name} ·{" "}
                    {item.inScope ? t("In scope") : t("Out of scope")}
                  </summary>
                  <form
                    className="mt-3 grid gap-3"
                    action={updateScope.bind(null, id, item.id)}
                  >
                    <Field label={t("Asset name")}>
                      <input
                        className={input}
                        name="name"
                        defaultValue={item.name}
                        required
                        maxLength={100}
                      />
                    </Field>
                    <ScopeTarget
                      t={t}
                      type={item.targetType}
                      target={item.target}
                    />
                    <Field label={t("Description")}>
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
                      {t("In scope")}
                    </label>
                    <Button>{t("Save asset")}</Button>
                  </form>
                </details>
              ))}
            </div>
          </section>
          <form
            className={`${panel} grid gap-3`}
            action={addScope.bind(null, id)}
          >
            <h2 className="font-semibold">{t("Add to scope")}</h2>
            <Text name="name" label={t("Asset name")} max={100} />
            <ScopeTarget t={t} />

            <Text
              name="description"
              label={t("Description")}
              multiline
              required={false}
            />
            <label className="flex gap-2 text-sm">
              <input type="checkbox" name="inScope" defaultChecked />{" "}
              {t("In scope")}
            </label>
            <Button>{t("Add asset")}</Button>
          </form>
          <form
            className={`${panel} grid gap-3`}
            action={setProgramRole.bind(null, id)}
          >
            <h2 className="font-semibold">{t("Program access")}</h2>
            <Text name="userId" label={t("User ID")} max={36} />
            <Field label={t("Role")}>
              <select name="role" className={input}>
                <option value="researcher">{t("researcher")}</option>
                <option value="triager">{t("triager")}</option>
                <option value="manager">{t("manager")}</option>
              </select>
            </Field>
            <div className="flex gap-2">
              <Button name="change" value="grant">
                {t("Grant")}
              </Button>
              <Button name="change" value="revoke">
                {t("Revoke")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function ScopeTarget({
  t,
  type = "other",
  target = "",
}: {
  t: (message: string) => string;
  type?: string;
  target?: string;
}) {
  return (
    <>
      <Field label={t("Target type")}>
        <select name="targetType" className={input} defaultValue={type}>
          {(["host", "ip", "cidr", "url", "other"] as const).map((kind) => (
            <option key={kind} value={kind}>
              {t(
                {
                  host: "Hostname",
                  ip: "IP address",
                  cidr: "CIDR network",
                  url: "URL",
                  other: "Other",
                }[kind],
              )}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Target value")}>
        <input
          name="target"
          className={input}
          defaultValue={target}
          maxLength={512}
          placeholder="*.example.org / 192.0.2.0/24"
        />
      </Field>
    </>
  );
}
