import { getI18n } from "../../../../../../lib/i18n";
import { Button } from "../../../../../../components/ui/button";
import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withActor } from "../../../../../../db";
import {
  notificationChannels,
  notificationDeliveries,
  notificationOutbox,
  programs,
} from "../../../../../../db/schema";
import { requireActor } from "../../../../../../lib/actor";
import { Field, input, panel, Text } from "../../../../../../lib/forms";
import {
  addNotification,
  notificationOperation,
} from "../../../../../../lib/notification-actions";
import { notificationEvents } from "../../../../../../notifications/policy";

export default async function Notifications({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { t, dateTime, number } = await getI18n();
  const actor = await requireActor();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { channels, history, attempts } = await withActor(actor, async (tx) => {
    const [program] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, id), sql`app_manages_program(${id}::uuid)`));
    if (!program) notFound();
    const channels = await tx
      .select({
        id: notificationChannels.id,
        kind: notificationChannels.kind,
        destination: notificationChannels.destination,
        enabled: notificationChannels.enabled,
      })
      .from(notificationChannels)
      .where(eq(notificationChannels.programId, id));
    const history = await tx
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.programId, id))
      .orderBy(desc(notificationOutbox.createdAt))
      .limit(30);
    const attempts = history.length
      ? await tx
          .select()
          .from(notificationDeliveries)
          .where(
            inArray(
              notificationDeliveries.outboxId,
              history.map(({ id }) => id),
            ),
          )
          .orderBy(desc(notificationDeliveries.attempt))
          .limit(600)
      : [];
    return { channels, history, attempts };
  });
  const status = await searchParams;
  return (
    <>
      <Link className="text-sm text-muted" href={`/programs/${id}/manage`}>
        {t("← Program settings")}
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {t("Notifications")}
      </h1>
      {status.error && (
        <p role="alert" className="mt-4 text-danger">
          {t("Check the channel settings or delivery state.")}
        </p>
      )}
      {status.saved && (
        <p role="status" className="mt-4">
          {t("Change saved.")}
        </p>
      )}
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <form
          className={`${panel} grid gap-4`}
          action={addNotification.bind(null, id)}
        >
          <h2 className="font-semibold">{t("Add channel")}</h2>
          <Field label={t("Transport")}>
            <select className={input} name="kind">
              <option value="smtp">{t("Email")}</option>
              <option value="webhook">{t("HTTPS webhook")}</option>
            </select>
          </Field>
          <Text
            name="destination"
            label={t("Email address or webhook URL")}
            max={2048}
          />
          <Field label={t("Webhook signing secret (minimum 32 characters)")}>
            <input
              name="signingSecret"
              type="password"
              className={input}
              maxLength={256}
            />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t("Events")}</legend>
            {notificationEvents.map((event) => (
              <label className="flex gap-2 text-sm" key={event}>
                <input
                  type="checkbox"
                  name="events"
                  value={event}
                  defaultChecked={event === "report.submitted"}
                />
                {t(event.replace("report.", "").replaceAll("_", " "))}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-2 text-sm font-medium">
              {t("Severity filters (empty means all)")}
            </legend>
            {["pending", "none", "low", "medium", "high", "critical"].map(
              (level) => (
                <label className="flex gap-2 text-sm capitalize" key={level}>
                  <input type="checkbox" name="severities" value={level} />
                  {t(level)}
                </label>
              ),
            )}
          </fieldset>
          <Button>{t("Add channel")}</Button>
        </form>
        <div className="grid gap-4">
          <section className={panel}>
            <h2 className="font-semibold">{t("Channels")}</h2>
            <ul className="mt-2 divide-y divide-line">
              {channels.map((channel) => (
                <li className="py-3 text-sm" key={channel.id}>
                  <p className="break-all">{channel.destination}</p>
                  <p className="text-muted">
                    {t(channel.kind)} ·{" "}
                    {channel.enabled ? t("Enabled") : t("Disabled")}
                  </p>
                  <form
                    action={notificationOperation.bind(null, id, channel.id)}
                    className="mt-2 flex gap-3"
                  >
                    {channel.enabled && (
                      <button
                        className="underline"
                        name="operation"
                        value="test"
                      >
                        {t("Send test")}
                      </button>
                    )}
                    <button
                      className="underline"
                      name="operation"
                      value={channel.enabled ? "disable" : "enable"}
                    >
                      {channel.enabled ? t("Disable") : t("Enable")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            {!channels.length && (
              <p className="mt-2 text-sm">{t("No channels configured.")}</p>
            )}
          </section>
          <section className={panel}>
            <h2 className="font-semibold">{t("Delivery history")}</h2>
            <ul className="mt-2 divide-y divide-line">
              {history.map((item) => (
                <li
                  className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                  key={item.id}
                >
                  <span>
                    {t(item.eventType)} · {t(item.status)} ·{" "}
                    {number(item.attempts)} {t("attempts")}
                    {item.publicReportId && ` · ${item.publicReportId}`}
                  </span>
                  {item.attempts > 0 && (
                    <details className="basis-full">
                      <summary className="cursor-pointer text-muted">
                        {t("Attempts")}
                      </summary>
                      <ul className="mt-1 space-y-1 pl-4">
                        {attempts
                          .filter((attempt) => attempt.outboxId === item.id)
                          .map((attempt) => (
                            <li key={attempt.id}>
                              {attempt.attempt}.{" "}
                              {t(attempt.result.replaceAll("_", " "))}{" "}
                              <time
                                className="ml-2 text-muted"
                                dateTime={attempt.createdAt.toISOString()}
                              >
                                {dateTime(attempt.createdAt)} UTC
                              </time>
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}
                  {item.status === "dead" && (
                    <form
                      action={notificationOperation.bind(null, id, item.id)}
                    >
                      <button
                        className="underline"
                        name="operation"
                        value="retry"
                      >
                        {t("Retry")}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {!history.length && (
              <p className="mt-2 text-sm">{t("No deliveries yet.")}</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
