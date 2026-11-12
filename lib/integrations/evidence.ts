import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db";
import { reportAttachments, reportEvents, reports } from "../../db/schema";
import { ReportError } from "./reports";

const scanFile = promisify(execFile);

export async function saveEvidence(
  actor: string,
  reportId: string,
  file: unknown,
) {
  z.uuid().parse(reportId);
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
    throw new ReportError(422, "evidence");
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
  if (!valid) throw new ReportError(422, "evidence");
  const name =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "evidence";
  const storageKey = randomUUID();
  const path = join(directory, storageKey);
  let stored = false;
  try {
    return await withActor(actor, async (tx) => {
      const [report] = await tx
        .select({ id: reports.id, redacted: reports.contentRedactedAt })
        .from(reports)
        .where(eq(reports.id, reportId));
      if (!report || report.redacted) throw new ReportError(404, "not-found");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${reportId}), 1)`,
      );
      const existing = await tx
        .select({ id: reportAttachments.id })
        .from(reportAttachments)
        .where(eq(reportAttachments.reportId, reportId))
        .limit(20);
      if (existing.length >= 20) throw new ReportError(429, "evidence-limit");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      stored = true;
      const scanner = process.env.ATTACHMENT_SCANNER;
      if (scanner) {
        if (!isAbsolute(scanner)) throw new ReportError(422, "scanner");
        const clean = await scanFile(scanner, [path], {
          timeout: 10_000,
          maxBuffer: 65_536,
        }).then(
          () => true,
          () => false,
        );
        if (!clean) throw new ReportError(422, "scanner");
      }
      const [entry] = await tx
        .insert(reportAttachments)
        .values({
          reportId,
          uploadedBy: actor,
          name,
          storageKey,
          mediaType: file.type,
          size: file.size,
        })
        .returning({
          id: reportAttachments.id,
          name: reportAttachments.name,
          size: reportAttachments.size,
          mediaType: reportAttachments.mediaType,
        });
      await tx
        .insert(reportEvents)
        .values({ reportId, actorId: actor, kind: "attachment_uploaded" });
      return entry;
    });
  } catch (error) {
    if (stored) {
      const linked = await withActor(actor, async (tx) => {
        const [{ exists }] = (
          await tx.execute<{ exists: boolean }>(
            sql`select exists (select from report_attachments where storage_key = ${storageKey}::uuid)`,
          )
        ).rows;
        return exists;
      }).catch(() => true);
      if (!linked) await unlink(path).catch(() => {});
    }
    throw error;
  }
}

export async function evidenceResponse(actor: string, id: string) {
  z.uuid().parse(id);
  const directory = process.env.ATTACHMENTS_DIR;
  if (!directory) throw new ReportError(404, "not-found");
  const [file] = await withActor(actor, (tx) =>
    tx.select().from(reportAttachments).where(eq(reportAttachments.id, id)),
  );
  if (!file) throw new ReportError(404, "not-found");
  const bytes = await readFile(join(directory, file.storageKey)).catch(
    () => null,
  );
  if (!bytes) throw new ReportError(404, "not-found");
  const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
