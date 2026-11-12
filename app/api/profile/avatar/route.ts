import { eq } from "drizzle-orm";
import { withActor } from "../../../../db";
import { profileAvatars } from "../../../../db/schema";
import { auth } from "../../../../lib/auth";

export async function GET() {
  const session = await auth();
  const headers = { "Cache-Control": "private, no-store" };
  if (!session?.actorId) return new Response(null, { status: 401, headers });

  const actor = session.actorId;
  const [avatar] = await withActor(actor, (tx) =>
    tx
      .select({ image: profileAvatars.image })
      .from(profileAvatars)
      .where(eq(profileAvatars.userId, actor)),
  );
  if (!avatar) return new Response(null, { status: 404, headers });
  return new Response(new Uint8Array(avatar.image), {
    headers: {
      ...headers,
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
