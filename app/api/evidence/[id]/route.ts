import { z } from "zod";
import { auth } from "../../../../lib/auth";
import { evidenceResponse } from "../../../../lib/integrations/evidence";
import { ReportError } from "../../../../lib/integrations/reports";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const { id } = await context.params;
  if (!session?.actorId || !z.uuid().safeParse(id).success)
    return new Response(null, { status: 404 });
  try {
    return await evidenceResponse(session.actorId, id);
  } catch (error) {
    if (error instanceof ReportError)
      return new Response(null, { status: error.status });
    throw error;
  }
}
