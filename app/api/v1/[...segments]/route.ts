import { loggedRoute } from "../../../../lib/telemetry/http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticateIntegration } from "../../../../lib/integrations/auth";
import { IntegrationError } from "../../../../lib/integrations/errors";
import {
  consumeRate,
  executeOperation,
  jsonResult,
  problem,
  protectTransport,
  readJson,
} from "../../../../lib/integrations/http";
import { operations } from "../../../../lib/integrations/operations";

async function handle(
  request: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  const requestId = randomUUID();
  try {
    protectTransport(request);
    const principal = await authenticateIntegration(request);
    await consumeRate(principal);
    const { segments } = await context.params;
    for (const operation of operations) {
      if (operation.method !== request.method) continue;
      const template = operation.path.slice(1).split("/");
      if (template.length !== segments.length) continue;
      const path: Record<string, string> = {};
      if (
        !template.every((part, index) => {
          if (part.startsWith("{")) {
            path[part.slice(1, -1)] = segments[index];
            return true;
          }
          return part === segments[index];
        })
      )
        continue;
      const url = new URL(request.url);
      const input: Record<string, unknown> = {};
      if (operation.method === "GET") {
        for (const [key, value] of url.searchParams) {
          if (
            Object.hasOwn(input, key) ||
            Object.hasOwn(path, key) ||
            !Object.hasOwn(operation.input.shape, key)
          )
            throw new IntegrationError(422, "invalid_input");
          input[key] =
            key === "limit" ||
            (key === "cursor" && operation.name === "bountydeck_list_reports")
              ? /^\d+$/.test(value)
                ? Number(value)
                : value
              : value;
        }
      } else {
        const body = z
          .record(z.string(), z.unknown())
          .safeParse(await readJson(request, operation.maxBytes));
        if (
          !body.success ||
          Object.keys(body.data).some(
            (key) =>
              Object.hasOwn(path, key) ||
              !Object.hasOwn(operation.input.shape, key),
          )
        ) {
          throw new IntegrationError(422, "invalid_input");
        }
        Object.assign(input, body.data);
      }
      return jsonResult(
        await executeOperation(
          principal,
          operation,
          { ...input, ...path },
          requestId,
          request.headers.get("idempotency-key") ?? undefined,
        ),
        operation.status,
        requestId,
      );
    }
    throw new IntegrationError(404, "not_found");
  } catch (error) {
    return problem(error, requestId, { challenge: true });
  }
}
const logged = loggedRoute("/api/v1/[...segments]", handle);
export const GET = logged;
export const POST = logged;
export const PATCH = logged;
