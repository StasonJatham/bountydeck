"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "./actor";
import { IntegrationError } from "./integrations/errors";
import {
  addChannel,
  notificationInput,
  notificationOperationInput,
  operateChannel,
} from "./integrations/notifications";

const path = (id: string) => `/programs/${id}/manage/notifications`;
const uuid = z.uuid();

export async function addNotification(programId: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(programId).success) notFound();
  const parsed = notificationInput.safeParse({
    ...Object.fromEntries(data),
    events: data.getAll("events"),
    severities: data.getAll("severities"),
  });
  if (!parsed.success) redirect(`${path(programId)}?error=invalid`);
  try {
    await addChannel(actor, programId, parsed.data);
  } catch (error) {
    if (error instanceof IntegrationError && error.status === 404) notFound();
    if (error instanceof IntegrationError && error.status === 422)
      redirect(`${path(programId)}?error=invalid`);
    throw error;
  }
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
  const parsed = notificationOperationInput.safeParse({
    operation: data.get("operation"),
  });
  if (!parsed.success) notFound();
  let ok: boolean;
  try {
    ok = await operateChannel(actor, programId, id, parsed.data.operation);
  } catch (error) {
    if (error instanceof IntegrationError && error.status === 404) notFound();
    throw error;
  }
  redirect(`${path(programId)}?${ok ? "saved=1" : "error=unavailable"}`);
}
