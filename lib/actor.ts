import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function requireActor() {
  const session = await auth();
  if (!session?.actorId) redirect("/api/auth/signin?callbackUrl=/dashboard");
  return session.actorId;
}
