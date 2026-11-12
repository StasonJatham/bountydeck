import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../../../db";
import { reportAttachments } from "../../../../db/schema";
import { auth } from "../../../../lib/auth";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const { id } = await context.params;
  const directory = process.env.ATTACHMENTS_DIR;
  if (!session?.actorId || !z.uuid().safeParse(id).success || !directory)
    return new Response(null, { status: 404 });
  const [file] = await withActor(session.actorId, (tx) =>
    tx.select().from(reportAttachments).where(eq(reportAttachments.id, id)),
  );
  if (!file) return new Response(null, { status: 404 });
  const bytes = await readFile(join(directory, file.storageKey)).catch(
    () => null,
  );
  if (!bytes) return new Response(null, { status: 404 });
  const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
