import { randomUUID } from "node:crypto";
import { logEvent } from "./logger";

export function loggedRoute<R extends Request, A extends unknown[]>(
  route: string,
  handler: (request: R, ...args: A) => Response | Promise<Response>,
  options: { failuresOnly?: boolean } = {},
) {
  return async (request: R, ...args: A): Promise<Response> => {
    const start = process.hrtime.bigint();
    const response = await handler(request, ...args);
    const requestId = response.headers.get("X-Request-Id") ?? randomUUID();
    const headers = new Headers(response.headers);
    headers.set("X-Request-Id", requestId);
    if (!options.failuresOnly || response.status >= 400) {
      logEvent({
        service: "application",
        action: "http.request.completed",
        message: "HTTP request completed",
        level:
          response.status >= 500
            ? "error"
            : response.status >= 400
              ? "warn"
              : "info",
        outcome: response.status >= 400 ? "failure" : "success",
        durationNs: Number(process.hrtime.bigint() - start),
        route,
        method: request.method,
        status: response.status,
        requestId,
        traceparent: request.headers.get("traceparent"),
      });
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
