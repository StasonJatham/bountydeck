import { Button } from "../../../../../../components/ui/button";
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withActor } from "../../../../../../db";
import {
  notificationChannels,
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
  const actor = await requireActor();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { channels, history } = await withActor(actor, async (tx) => {
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
    return { channels, history };
  });
  const status = await searchParams;
  return (
    <>
      <Link
        className="text-sm text-neutral-600"
        href={`/programs/${id}/manage`}
      >
        ← Program settings
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Notifications
      </h1>
      {status.error && (
        <p role="alert" className="mt-4 text-red-800">
          Check the channel settings or delivery state.
        </p>
      )}
      {status.saved && (
        <p role="status" className="mt-4">
          Change saved.
        </p>
      )}
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <form
          className={`${panel} grid gap-4`}
          action={addNotification.bind(null, id)}
        >
          <h2 className="font-semibold">Add channel</h2>
          <Field label="Transport">
            <select className={input} name="kind">
              <option value="smtp">Email</option>
              <option value="webhook">HTTPS webhook</option>
            </select>
          </Field>
          <Text
            name="destination"
            label="Email address or webhook URL"
            max={2048}
          />
          <Field label="Webhook signing secret (minimum 32 characters)">
            <input
              name="signingSecret"
              type="password"
              className={input}
              maxLength={256}
            />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Events</legend>
            {notificationEvents.map((event) => (
              <label className="flex gap-2 text-sm" key={event}>
                <input
                  type="checkbox"
                  name="events"
                  value={event}
                  defaultChecked={event === "report.submitted"}
                />
                {event.replace("report.", "").replaceAll("_", " ")}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-2 text-sm font-medium">
              Severity filters (empty means all)
            </legend>
            {["pending", "none", "low", "medium", "high", "critical"].map(
              (level) => (
                <label className="flex gap-2 text-sm capitalize" key={level}>
                  <input type="checkbox" name="severities" value={level} />
                  {level}
                </label>
              ),
            )}
          </fieldset>
          <Button>Add channel</Button>
        </form>
        <div className="grid gap-4">
          <section className={panel}>
            <h2 className="font-semibold">Channels</h2>
            <ul className="mt-2 divide-y divide-neutral-200">
              {channels.map((channel) => (
                <li className="py-3 text-sm" key={channel.id}>
                  <p className="break-all">{channel.destination}</p>
                  <p className="text-neutral-600">
                    {channel.kind} · {channel.enabled ? "Enabled" : "Disabled"}
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
                        Send test
                      </button>
                    )}
                    <button
                      className="underline"
                      name="operation"
                      value={channel.enabled ? "disable" : "enable"}
                    >
                      {channel.enabled ? "Disable" : "Enable"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            {!channels.length && (
              <p className="mt-2 text-sm">No channels configured.</p>
            )}
          </section>
          <section className={panel}>
            <h2 className="font-semibold">Delivery history</h2>
            <ul className="mt-2 divide-y divide-neutral-200">
              {history.map((item) => (
                <li
                  className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                  key={item.id}
                >
                  <span>
                    {item.eventType} · {item.status} · {item.attempts} attempts
                  </span>
                  {item.status === "dead" && (
                    <form
                      action={notificationOperation.bind(null, id, item.id)}
                    >
                      <button
                        className="underline"
                        name="operation"
                        value="retry"
                      >
                        Retry
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {!history.length && (
              <p className="mt-2 text-sm">No deliveries yet.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
