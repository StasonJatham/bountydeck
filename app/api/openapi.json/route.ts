import { loggedRoute } from "../../../lib/telemetry/http";
import { auth } from "../../../lib/auth";
import { authenticateIntegration } from "../../../lib/integrations/auth";
import { IntegrationError } from "../../../lib/integrations/errors";
import { problem, protectTransport } from "../../../lib/integrations/http";
import { openApi } from "../../../lib/integrations/openapi";

async function handle(request: Request) {
  try {
    if (request.headers.has("authorization")) {
      protectTransport(request);
      await authenticateIntegration(request);
    } else if (!(await auth())?.actorId) {
      throw new IntegrationError(401, "authentication_required");
    }
    return Response.json(openApi(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return problem(error, undefined, { challenge: true });
  }
}

export const GET = loggedRoute("/api/openapi.json", handle);
