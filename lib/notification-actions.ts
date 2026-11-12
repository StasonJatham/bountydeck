"use server";

import { and, eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import { auditEvents, notificationChannels } from "../db/schema";
import {
  approvedWebhook,
  notificationEvents,
  parseWebhookDestinations,
  validRecipient,
} from "../notifications/policy";
import { requireActor } from "./actor";

const path = (id: string) => `/programs/${id}/manage/notifications`;
const uuid = z.uuid();

export async function addNotification(programId: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(programId).success) notFound();
  const parsed = z
    .object({
      kind: z.enum(["smtp", "webhook"]),
      destination: z.string().trim().min(1).max(2048),
      signingSecret: z.string().max(256),
      events: z.array(z.enum(notificationEvents)).min(1),
      severities: z
        .array(z.enum(["pending", "none", "low", "medium", "high", "critical"]))
        .max(6),
    })
    .safeParse({
      ...Object.fromEntries(data),
      events: data.getAll("events"),
      severities: data.getAll("severities"),
    });
  if (!parsed.success) redirect(`${path(programId)}?error=invalid`);
  const { kind, destination, signingSecret, events, severities } = parsed.data;
  if (kind === "smtp" && !validRecipient(destination))
    redirect(`${path(programId)}?error=invalid`);
  if (kind === "webhook") {
    try {
      approvedWebhook(
        destination,
        parseWebhookDestinations(process.env.WEBHOOK_DESTINATIONS),
      );
      if (signingSecret.length < 32) throw new Error();
    } catch {
      redirect(`${path(programId)}?error=invalid`);
    }
  }
  await withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_manages_program(${programId}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      notFound();
    await tx.insert(notificationChannels).values({
      programId,
      kind,
      destination,
      signingSecret: kind === "webhook" ? signingSecret : null,
      subscribedEvents: events,
      severities,
    });
    await tx.insert(auditEvents).values({
      actorId: actor,
      kind: "notifications.channel_added",
      details: { programId, kind },
    });
  });
  redirect(path(programId));
}

export async function notificationOperation(
  programId: string,
  id: string,
  data: FormData,
) {
  const actor = await requireActor();
  if (!uuid.safeParse(programId).success || !uuid.safeParse(id).success)
    notFound();
  const operation = data.get("operation");
  if (
    operation !== "test" &&
    operation !== "retry" &&
    operation !== "disable" &&
    operation !== "enable"
  )
    notFound();
  const ok = await withActor(actor, async (tx) => {
    if (
      !(
        await tx.execute<{ ok: boolean }>(
          sql`select app_manages_program(${programId}::uuid) as ok`,
        )
      ).rows[0].ok
    )
      notFound();
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
        ? sql`select test_notification(${id}::uuid) as ok`
        : sql`select retry_notification(${id}::uuid) as ok`;
    return (await tx.execute<{ ok: boolean }>(query)).rows[0].ok;
  });
  redirect(`${path(programId)}?${ok ? "saved=1" : "error=unavailable"}`);
}
