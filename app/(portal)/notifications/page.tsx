import Link from "next/link";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withActor } from "../../../db";
import { Button } from "../../../components/ui/button";
import { requireActor } from "../../../lib/actor";
import { Field, input, panel } from "../../../lib/forms";
import { getI18n } from "../../../lib/i18n";
import {
  approvedWebhook,
  parseWebhookDestinations,
} from "../../../notifications/policy";
import { WebhookSwitch } from "./webhook-switch";

const events = {
  "report.submitted": "My report submitted",
  "report.updated": "My report updated",
  "report.comment_added": "Comment on my report",
  "program.published": "New program available",
  "program.updated": "Program updated",
} as const;
const path = "/notifications";

async function save(data: FormData) {
  "use server";
  const actor = await requireActor();
  const enabled = data.has("enabled");
  const destination = String(data.get("destination") ?? "").trim();
  const secret = String(data.get("secret") ?? "");
  const subscriptions = Object.keys(events).filter((event) =>
    data.getAll("events").includes(event),
  );
  if (!enabled && !destination && !secret) {
    await withActor(actor, (tx) =>
      tx.execute(
        sql`update notification_channels set enabled = false where owner_id = ${actor}`,
      ),
    );
    redirect(path + "?saved=1");
  }
  if (
    destination.length > 2048 ||
    (secret && (secret.length < 32 || secret.length > 256))
  )
    redirect(path + "?error=1");
  const saved = await withActor(actor, async (tx) => {
    const {
      rows: [existing],
    } = await tx.execute<{ id: string; destination: string }>(sql`
      select id, destination from notification_channels where owner_id = ${actor} for update
    `);
    const changingDestination = existing?.destination !== destination;
    if (changingDestination && !secret) return false;
    if (enabled || changingDestination) {
      try {
        approvedWebhook(
          destination,
          parseWebhookDestinations(process.env.WEBHOOK_DESTINATIONS),
        );
      } catch {
        return false;
      }
    }
    const selected = sql`ARRAY[${sql.join(
      subscriptions.map((event) => sql`${event}`),
      sql`, `,
    )}]::text[]`;
    if (existing) {
      await tx.execute(sql`update notification_channels set enabled = ${enabled}, destination = ${destination},
        signing_secret = coalesce(${secret || null}, signing_secret), subscribed_events = ${selected} where id = ${existing.id}`);
    } else {
      const result =
        await tx.execute(sql`insert into notification_channels (owner_id, kind, destination, signing_secret, subscribed_events, enabled)
        values (${actor}, 'webhook', ${destination}, ${secret}, ${selected}, ${enabled}) on conflict (owner_id) do nothing`);
      return result.rowCount === 1;
    }
    return true;
  });
  redirect(path + (saved ? "?saved=1" : "?error=1"));
}

export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const { t, dateTime } = await getI18n();
  const query = await searchParams;
  const { channel, deliveries } = await withActor(actor, async (tx) => {
    const {
      rows: [channel],
    } = await tx.execute<{
      destination: string;
      enabled: boolean;
      subscribed_events: string[];
    }>(sql`
      select destination, enabled, subscribed_events from notification_channels where owner_id = ${actor}
    `);
    const { rows: deliveries } = await tx.execute<{
      id: string;
      event_type: keyof typeof events;
      status: string;
      created_at: string;
    }>(sql`
      select o.id, o.event_type, o.status, o.created_at from notification_outbox o
      join notification_channels c on c.id = o.channel_id where c.owner_id = ${actor}
      order by o.created_at desc limit 25
    `);
    return { channel, deliveries };
  });
  return (
    <div className="grid max-w-2xl grid-cols-1 gap-4">
      <h1 className="text-3xl font-semibold">{t("Notifications")}</h1>
      <Link
        className="text-accent underline"
        href="/reports?status=needs_information"
      >
        {t("Reports needing information")}
      </Link>
      {query.saved && <p role="status">{t("Webhook preferences saved.")}</p>}
      {query.error && (
        <p role="alert">
          {t(
            "Use an approved HTTPS destination and a signing secret of at least 32 characters.",
          )}
        </p>
      )}
      <form action={save} className={`${panel} grid gap-3`}>
        <h2 className="font-semibold">{t("Personal outgoing webhook")}</h2>
        <WebhookSwitch
          name="enabled"
          value="yes"
          label={t("Enable webhook")}
          initial={channel?.enabled ?? false}
        />
        <Field label={t("Destination URL")}>
          <input
            type="url"
            name="destination"
            className={input}
            defaultValue={channel?.destination}
            maxLength={2048}
          />
        </Field>
        <Field label={t("Signing secret")}>
          <input
            type="password"
            name="secret"
            className={input}
            maxLength={256}
            autoComplete="new-password"
          />
        </Field>
        {Object.entries(events).map(([event, label]) => (
          <WebhookSwitch
            key={event}
            name="events"
            value={event}
            label={t(label)}
            initial={channel?.subscribed_events.includes(event) ?? false}
          />
        ))}
        <Button>{t("Save settings")}</Button>
      </form>
      <section className={panel}>
        <h2 className="font-semibold">{t("Recent webhook deliveries")}</h2>
        {deliveries.length ? (
          <ul className="divide-y divide-line">
            {deliveries.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap justify-between gap-2 py-2 text-sm"
              >
                <span>{t(events[item.event_type] ?? item.event_type)}</span>
                <span>
                  {t(item.status)} · {dateTime(new Date(item.created_at))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {t("No webhook deliveries yet.")}
          </p>
        )}
      </section>
    </div>
  );
}
