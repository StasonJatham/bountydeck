"use server";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import { reportAttachments, reportEvents, reports } from "../db/schema";
import { requireActor } from "./actor";

export async function uploadEvidence(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(reportId).success) notFound();
  const file = data.get("evidence");
  const directory = process.env.ATTACHMENTS_DIR;
  const allowed = (
    process.env.ATTACHMENT_TYPES ?? "image/png,text/plain"
  ).split(",");
  if (
    !directory ||
    !(file instanceof File) ||
    file.size < 1 ||
    file.size > 5 * 1024 * 1024 ||
    !allowed.includes(file.type)
  ) {
    redirect(`/reports/${reportId}?error=evidence`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const valid =
    file.type === "image/png"
      ? bytes.length >= 33 &&
        bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
        bytes.subarray(12, 16).toString() === "IHDR"
      : file.type === "text/plain" &&
        !bytes.includes(0) &&
        Buffer.from(bytes.toString("utf8")).equals(bytes);
  if (!valid) redirect(`/reports/${reportId}?error=evidence`);
  const name =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "evidence";
  const storageKey = randomUUID();
  const path = join(directory, storageKey);
  let stored = false;
  try {
    await withActor(actor, async (tx) => {
      const [report] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(eq(reports.id, reportId));
      if (!report) notFound();
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${reportId}), 1)`,
      );
      const existing = await tx
        .select({ id: reportAttachments.id })
        .from(reportAttachments)
        .where(eq(reportAttachments.reportId, reportId))
        .limit(20);
      if (existing.length >= 20)
        redirect(`/reports/${reportId}?error=evidence-limit`);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      stored = true;
      await tx.insert(reportAttachments).values({
        reportId,
        uploadedBy: actor,
        name,
        storageKey,
        mediaType: file.type,
        size: file.size,
      });
      await tx
        .insert(reportEvents)
        .values({ reportId, actorId: actor, kind: "attachment_uploaded" });
    });
  } catch (error) {
    if (stored) await unlink(path).catch(() => {});
    throw error;
  }
  redirect(`/reports/${reportId}`);
}
