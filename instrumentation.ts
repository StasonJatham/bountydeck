import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logEvent } = await import("./lib/telemetry/logger");
  logEvent({
    service: "application",
    action: "application.started",
    message: "BountyDeck application started",
  });
}

export const onRequestError: Instrumentation.onRequestError = async (
  _error,
  _request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logEvent } = await import("./lib/telemetry/logger");
  logEvent({
    service: "application",
    level: "error",
    action: "http.request.unhandled_error",
    outcome: "failure",
    message: "Unhandled application request error",
    route: context.routePath,
  });
};
