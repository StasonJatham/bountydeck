import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function requireActor() {
  const session = await auth();
  if (!session?.actorId) redirect("/sign-in");
  return session.actorId;
}
