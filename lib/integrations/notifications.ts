import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor, type Tx } from "../../db";
import {
  auditEvents,
  notificationChannels,
  notificationDeliveries,
  notificationOutbox,
} from "../../db/schema";
import {
  approvedWebhook,
  notificationEvents,
  parseWebhookDestinations,
  validRecipient,
} from "../../notifications/policy";
import { IntegrationError } from "./errors";

export const notificationInput = z.object({
  kind: z.enum(["smtp", "webhook"]),
  destination: z.string().trim().min(1).max(2048),
  signingSecret: z.string().max(256).default(""),
  events: z
    .array(z.enum(notificationEvents))
    .min(1)
    .max(notificationEvents.length),
  severities: z
    .array(z.enum(["pending", "none", "low", "medium", "high", "critical"]))
    .max(6)
    .default([]),
});
export const notificationOperationInput = z.object({
  operation: z.enum(["test", "retry", "disable", "enable"]),
});

async function requireManager(tx: Tx, id: string) {
  const result = await tx.execute<{ ok: boolean }>(
    sql`select app_manages_program(${id}::uuid) as ok`,
  );
  if (!result.rows[0].ok) throw new IntegrationError(404, "not_found");
}

export function addChannel(
  actor: string,
  programId: string,
  input: z.infer<typeof notificationInput>,
) {
  return withActor(actor, async (tx) => {
    await requireManager(tx, programId);
    const { kind, destination, signingSecret, events, severities } = input;
    if (kind === "smtp" && !validRecipient(destination))
      throw new IntegrationError(422, "invalid_destination");
    if (kind === "webhook") {
      try {
        approvedWebhook(
          destination,
          parseWebhookDestinations(process.env.WEBHOOK_DESTINATIONS),
        );
        if (signingSecret.length < 32) throw new Error();
      } catch {
        throw new IntegrationError(422, "invalid_destination");
      }
    }
    const [channel] = await tx
      .insert(notificationChannels)
      .values({
        programId,
        kind,
        destination,
        signingSecret: kind === "webhook" ? signingSecret : null,
        subscribedEvents: events,
        severities,
      })
      .returning({ id: notificationChannels.id });
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "notifications.channel_added",
      details: { programId, kind },
    });
    return channel;
  });
}

export function operateChannel(
  actor: string,
  programId: string,
  id: string,
  operation: z.infer<typeof notificationOperationInput>["operation"],
) {
  return withActor(actor, async (tx) => {
    await requireManager(tx, programId);
    if (operation === "disable" || operation === "enable") {
      const rows = await tx
        .update(notificationChannels)
        .set({ enabled: operation === "enable" })
        .where(
          and(
            eq(notificationChannels.id, id),
            eq(notificationChannels.programId, programId),
          ),
        )
        .returning({ id: notificationChannels.id });
      return rows.length > 0;
    }
    const query =
      operation === "test"
        ? sql`select test_notification(${id}::uuid) as ok from notification_channels where id = ${id}::uuid and program_id = ${programId}::uuid`
        : sql`select retry_notification(${id}::uuid) as ok from notification_outbox where id = ${id}::uuid and program_id = ${programId}::uuid`;
    return (await tx.execute<{ ok: boolean }>(query)).rows[0]?.ok ?? false;
  });
}

export function listNotifications(actor: string, programId: string) {
  return withActor(actor, async (tx) => {
    await requireManager(tx, programId);
    const channels = await tx
      .select({
        id: notificationChannels.id,
        kind: notificationChannels.kind,
        destination: notificationChannels.destination,
        enabled: notificationChannels.enabled,
        subscribedEvents: notificationChannels.subscribedEvents,
        severities: notificationChannels.severities,
      })
      .from(notificationChannels)
      .where(eq(notificationChannels.programId, programId))
      .orderBy(notificationChannels.id)
      .limit(200);
    const deliveries = await tx
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.programId, programId))
      .orderBy(desc(notificationOutbox.createdAt), desc(notificationOutbox.id))
      .limit(100);
    return { channels, deliveries };
  });
}

export function getDelivery(actor: string, programId: string, id: string) {
  return withActor(actor, async (tx) => {
    await requireManager(tx, programId);
    const [delivery] = await tx
      .select()
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.id, id),
          eq(notificationOutbox.programId, programId),
        ),
      );
    if (!delivery) throw new IntegrationError(404, "not_found");
    const attempts = await tx
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.outboxId, id))
      .orderBy(notificationDeliveries.attempt);
    return { delivery, attempts };
  });
}
