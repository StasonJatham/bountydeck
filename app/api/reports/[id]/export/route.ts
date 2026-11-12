import { loggedRoute } from "../../../../../lib/telemetry/http";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../../../../db";
import {
  auditEvents,
  platformSettings,
  reportComments,
  reports,
} from "../../../../../db/schema";
import { auth } from "../../../../../lib/auth";

async function handle(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (process.env.REPORT_EXPORTS_ENABLED === "false")
    return new Response(null, { status: 404 });
  const session = await auth();
  const { id } = await context.params;
  if (!session?.actorId || !z.uuid().safeParse(id).success)
    return new Response(null, { status: 404 });
  const actorId = session.actorId;
  const result = await withActor(actorId, async (tx) => {
    const [settings] = await tx
      .select({ enabled: platformSettings.reportExports })
      .from(platformSettings);
    if (!settings.enabled) return null;
    const [report] = await tx
      .select({
        number: reports.number,
        title: reports.title,
        description: reports.description,
        cwe: reports.cwe,
        steps: reports.steps,
        proofOfConcept: reports.proofOfConcept,
        impact: reports.impact,
        status: reports.status,
        severity: reports.severity,
        proposedSeverity: reports.proposedSeverity,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(and(eq(reports.id, id), isNull(reports.contentRedactedAt)));
    if (!report) return null;
    const comments = await tx
      .select({
        body: reportComments.body,
        createdAt: reportComments.createdAt,
      })
      .from(reportComments)
      .where(eq(reportComments.reportId, id));
    await tx
      .insert(auditEvents)
      .values({ actorId, kind: "report.exported", details: { reportId: id } });
    return { report, comments };
  });
  if (!result) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(result, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="BSO-${result.report.number}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const GET = loggedRoute("/api/reports/[id]/export", handle);
