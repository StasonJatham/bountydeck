import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../../../../db";
import { auditEvents, reportComments, reports } from "../../../../../db/schema";
import { auth } from "../../../../../lib/auth";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const { id } = await context.params;
  if (!session?.actorId || !z.uuid().safeParse(id).success)
    return new Response(null, { status: 404 });
  const actorId = session.actorId;
  const result = await withActor(actorId, async (tx) => {
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
      .where(eq(reports.id, id));
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
