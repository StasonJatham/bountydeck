"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guestReporterId, guestReportsEnabled } from "./guest-reports";
import { requireActor } from "./actor";
import {
  addComment,
  assignReport,
  correctReportScore,
  createReport,
  ReportError,
  transitionReport,
} from "./integrations/reports";

async function runForm<T>(
  path: string,
  invalid: string,
  execute: () => Promise<T>,
) {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof ReportError) {
      if (error.status === 404) notFound();
      redirect(`${path}?error=${error.code}`);
    }
    if (error instanceof z.ZodError) redirect(`${path}?error=${invalid}`);
    throw error;
  }
}

async function reportFields(data: FormData, path: string) {
  const { proofFile, ...fields } = Object.fromEntries(data);
  if (!(proofFile instanceof File) || !proofFile.size)
    return fields;
  const invalid = () =>
    redirect(`${path}?error=invalid-proof-file#submit-report`);
  if (!/\.txt$/i.test(proofFile.name) || proofFile.size > 512 * 1024) invalid();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await proofFile.arrayBuffer(),
    );
  } catch {
    return invalid();
  }
  if (!text.trim() || text.includes("\0")) invalid();
  return { ...fields, proofOfConcept: text };
}

export async function submitReport(programId: string, data: FormData) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(programId).success) notFound();
  const { id } = await runForm(
    `/programs/${programId}`,
    "invalid-report",
    async () =>
      createReport(
        actor,
        programId,
        await reportFields(data, `/programs/${programId}`),
      ),
  );
  redirect(`/reports/${id}`);
}

export async function submitGuestReport(programId: string, data: FormData) {
  if (!guestReportsEnabled() || !z.uuid().safeParse(programId).success)
    notFound();
  await runForm(`/guest-report/${programId}`, "invalid-report", async () =>
    createReport(
      guestReporterId,
      programId,
      await reportFields(data, `/guest-report/${programId}`),
    ),
  );
  redirect("/guest-report?submitted=1");
}

export async function comment(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(reportId).success) notFound();
  const path = `/reports/${reportId}`;
  await runForm(path, "invalid-comment", () =>
    addComment(actor, reportId, {
      body: data.get("body"),
      internal: data.get("internal") === "on",
    }),
  );
  revalidatePath(path);
}

export async function transition(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(reportId).success) notFound();
  const path = `/reports/${reportId}`;
  await runForm(path, "transition", () =>
    transitionReport(actor, reportId, {
      status: data.get("status"),
      severity: data.get("severity") || undefined,
      cvssVector: data.get("cvssVector") || null,
      duplicateOf: data.get("duplicateOf") || undefined,
    }),
  );
  revalidatePath(path);
}

export async function correctScore(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(reportId).success) notFound();
  const path = `/reports/${reportId}`;
  const points = z
    .string()
    .regex(/^-?\d{1,6}$/)
    .transform(Number)
    .safeParse(data.get("points"));
  if (!points.success) redirect(`${path}?error=score`);
  await runForm(path, "score", () =>
    correctReportScore(actor, reportId, {
      points: points.data,
      reason: data.get("reason"),
    }),
  );
  revalidatePath(path);
}

export async function assign(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(reportId).success) notFound();
  const path = `/reports/${reportId}`;
  await runForm(path, "assignee", () =>
    assignReport(actor, reportId, {
      assigneeId: data.get("assignee") === "" ? null : data.get("assignee"),
    }),
  );
  revalidatePath(path);
}
