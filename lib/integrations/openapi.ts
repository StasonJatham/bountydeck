import { z } from "zod";
import { operations, type Operation } from "./operations";

const uuid = z.uuid();
const count = z.number().int();
const item = z.object({ id: uuid }).passthrough();
const collection = (row: z.ZodType, cursor: z.ZodType = uuid) =>
  z.object({ items: z.array(row), nextCursor: cursor.nullable().optional() });
const date = z.iso.datetime();
const organization = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string(),
});
const program = z
  .object({
    id: uuid,
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    eligibility: z.string(),
    canSubmit: z.boolean(),
    canReview: z.boolean(),
    canManage: z.boolean(),
  })
  .passthrough();
const report = z
  .object({
    id: uuid,
    number: count,
    programId: uuid,
    title: z.string(),
    status: z.string(),
    proposedSeverity: z.string(),
    severity: z.string().nullable(),
    createdAt: date,
    updatedAt: date,
  })
  .passthrough();
const attachment = z
  .object({
    id: uuid,
    reportId: uuid,
    name: z.string(),
    mediaType: z.string(),
    size: count,
  })
  .passthrough();
const outputs: Record<string, z.ZodType> = {
  get_identity: z.object({
    id: uuid,
    name: z.string().nullable(),
    platformRole: z.string(),
    actorType: z.enum(["delegated", "service"]),
    clientId: z.string(),
    organizationRoles: z.array(
      z.object({ orgId: uuid, userId: uuid, role: z.string() }),
    ),
    programRoles: z.array(
      z.object({ programId: uuid, userId: uuid, role: z.string() }),
    ),
  }),
  list_organization_memberships: collection(
    z.object({ orgId: uuid, userId: uuid, role: z.string() }),
    z.object({ afterUser: uuid, afterRole: z.string() }),
  ),
  list_program_memberships: collection(
    z.object({ programId: uuid, userId: uuid, role: z.string() }),
    z.object({ afterUser: uuid, afterRole: z.string() }),
  ),
  get_notification_delivery: z.object({
    delivery: item,
    attempts: z.array(item),
  }),
  list_organizations: collection(organization),
  get_organization: organization,
  list_programs: collection(program),
  get_program: program,
  list_reports: collection(
    z.object({
      id: uuid,
      number: count,
      programId: uuid,
      title: z.string(),
      status: z.string(),
      createdAt: date,
      severity: z.string(),
      program: z.string().nullable(),
    }),
    count,
  ),
  get_report: report,
  get_report_history: collection(
    z
      .object({
        id: uuid,
        reportId: uuid,
        actorId: uuid,
        kind: z.string(),
        createdAt: date,
      })
      .passthrough(),
  ),
  list_comments: collection(
    z.object({
      id: uuid,
      reportId: uuid,
      authorId: uuid,
      body: z.string(),
      internal: z.boolean(),
      createdAt: date,
    }),
  ),
  list_attachments: collection(attachment),
  upload_attachment: attachment,
  get_researcher_profile: z.object({
    points: z.string(),
    validated: count,
    achievements: z.array(z.string()),
    programs: z.array(
      z.object({
        program_id: uuid,
        name: z.string(),
        points: z.string(),
        validated: count,
        earned_rewards: z.array(z.string()),
      }),
    ),
    seasons: z.array(
      z.object({
        period: z.enum(["quarter", "year"]),
        starts_at: date,
        ends_at: date,
        points: z.string(),
        standing: z.string().nullable(),
      }),
    ),
  }),
  get_score_history: collection(
    z
      .object({
        id: uuid,
        reportId: uuid,
        points: count,
        reason: z.string(),
        kind: z.string(),
        createdAt: date,
      })
      .passthrough(),
  ),
  get_leaderboard: collection(
    z.object({
      user_id: uuid,
      label: z.string(),
      points: z.string(),
      standing: z.string(),
      is_self: z.boolean(),
    }),
    z.object({ afterPoints: z.string(), afterUser: uuid }),
  ),
  list_notifications: z.object({
    channels: z.array(item),
    deliveries: z.array(item),
  }),
};
const idOperations = new Set([
  "create_organization",
  "update_organization",
  "create_program",
  "update_program",
  "create_report",
  "add_comment",
  "add_notification",
]);
const accepted = z.object({ ok: z.literal(true) });
const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: count,
  code: z.string(),
  requestId: uuid,
});
const sampleId = "00000000-0000-4000-8000-000000000001";
const sampleComment = {
  body: "Confirmed the case details with the reporting team.",
  internal: true,
};
const sampleProgramList = { items: [], nextCursor: null };
const requestExamples: Record<string, unknown> = {
  add_comment: sampleComment,
  change_report_status: { status: "validated", severity: "medium" },
  set_report_severity: { severity: "medium" },
  assign_report: { assigneeId: sampleId },
};

function schema(type: z.ZodType) {
  const result = z.toJSONSchema(type, { io: "input", unrepresentable: "any" });
  delete result.$schema;
  return result;
}

function operationSpec(operation: Operation) {
  const action = operation.name.slice("bountydeck_".length);
  const shape = operation.input.shape;
  const pathNames = new Set(
    Array.from(operation.path.matchAll(/\{([^}]+)\}/g), (match) => match[1]),
  );
  const parameters: Record<string, unknown>[] = Object.entries(shape).flatMap(
    ([name, property]) => {
      const inPath = pathNames.has(name);
      if (!inPath && operation.method !== "GET") return [];
      return [
        {
          name,
          in: inPath ? "path" : "query",
          required: inPath || !property.isOptional(),
          schema: schema(property),
          ...(inPath
            ? { example: sampleId }
            : name === "limit"
              ? { example: 30 }
              : {}),
        },
      ];
    },
  );
  if (operation.method !== "GET" && action !== "upload_attachment")
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: false,
      schema: { type: "string", maxLength: 128 },
    });
  const responses: Record<string, unknown> = {
    [operation.status]: {
      description:
        operation.status === 201 ? "Created" : "Successful operation",
      headers: {
        "X-Request-Id": { schema: { type: "string", format: "uuid" } },
      },
      content: operation.binary
        ? {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          }
        : {
            "application/json": {
              schema: schema(
                outputs[action] ??
                  (idOperations.has(action)
                    ? z.object({ id: uuid })
                    : accepted),
              ),
              ...(action === "list_programs"
                ? { example: sampleProgramList }
                : idOperations.has(action)
                  ? { example: { id: sampleId } }
                  : {}),
            },
          },
    },
  };
  for (const [status, description] of Object.entries({
    400: "Invalid JSON",
    401: "Access token missing or invalid",
    403: "Insufficient scope or rejected origin",
    404: "Resource unavailable to the caller",
    409: "Operation conflicts with current state or idempotency key",
    413: "Request or response exceeds its limit",
    415: "Expected application/json",
    422: "Invalid input",
    429: "Rate limited",
    500: "Server error",
    503: "Integration or provider unavailable",
  }))
    responses[status] = {
      description,
      content: {
        "application/problem+json": { schema: schema(problemSchema) },
      },
    };
  const body = z
    .object(
      Object.fromEntries(
        Object.entries(shape).filter(([key]) => !pathNames.has(key)),
      ),
    )
    .strict();
  return {
    operationId: operation.name,
    summary: operation.summary,
    description: `Permission: ${operation.permission}.`,
    parameters,
    ...(operation.method !== "GET" && Object.keys(body.shape).length > 0
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: schema(body),
                ...(requestExamples[action]
                  ? { example: requestExamples[action] }
                  : {}),
              },
            },
          },
        }
      : {}),
    responses,
  };
}

export function openApi() {
  const scope = process.env.INTEGRATION_SCOPE || "bountydeck.api";
  const issuer =
    process.env.OIDC_ISSUER?.replace(/\/$/, "") ||
    "https://identity.example.test";
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations)
    (paths[operation.path] ??= {})[operation.method.toLowerCase()] =
      operationSpec(operation);
  return {
    openapi: "3.1.0",
    info: {
      title: "BountyDeck API",
      version: "1.0.0",
      description:
        "Versioned defensive case-management API. Obtain an OAuth access token for the canonical MCP resource URL and required scope. Pass it in the Authorization header. ID tokens are rejected. Use nextCursor to request the next page.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ accessToken: [] }, { openId: [scope] }],
    components: {
      securitySchemes: {
        accessToken: {
          type: "http",
          scheme: "bearer",
          description: `OAuth access token with the ${scope} scope.`,
        },
        openId: {
          type: "openIdConnect",
          openIdConnectUrl: `${issuer}/.well-known/openid-configuration`,
        },
      },
    },
    paths,
  };
}
