import { loggedRoute } from "../../../../lib/telemetry/http";
import { handlers } from "../../../../lib/auth";
export const GET = loggedRoute("/api/auth/[...nextauth]", handlers.GET);
export const POST = loggedRoute("/api/auth/[...nextauth]", handlers.POST);
