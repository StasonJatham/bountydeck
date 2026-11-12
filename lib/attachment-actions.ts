"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "./actor";
import { saveEvidence } from "./integrations/evidence";
import { ReportError } from "./integrations/reports";

export async function uploadEvidence(reportId: string, data: FormData) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(reportId).success) notFound();
  const path = `/reports/${reportId}`;
  try {
    await saveEvidence(actor, reportId, data.get("evidence"));
  } catch (error) {
    if (!(error instanceof ReportError)) throw error;
    if (error.status === 404) notFound();
    redirect(`${path}?error=${error.code}`);
  }
  redirect(path);
}
