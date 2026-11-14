import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const date = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

const userIdentity = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: date("email_verified"),
  image: text("image"),
});

export const authUsers = pgTable("users", userIdentity());

export const users = pgTable("users", {
  ...userIdentity(),
  loginDisabled: boolean("login_disabled").notNull().default(false),
  platformRole: text("platform_role", { enum: ["admin", "researcher"] })
    .notNull()
    .default("researcher"),
  pseudonym: text("pseudonym"),
  leaderboardVisible: boolean("leaderboard_visible").notNull().default(false),
});

export const profileAvatars = pgTable("profile_avatars", {
  updatedAt: date("updated_at").notNull().defaultNow(),
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  image: customType<{ data: Buffer }>({ dataType: () => "bytea" })(
    "image",
  ).notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: date("expires").notNull(),
});

export const orgUnits = pgTable("org_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
});

export const orgMemberships = pgTable(
  "org_memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgUnits.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["admin", "member", "oversight"] }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId, table.role] })],
);

export const programs = pgTable("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgUnits.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull().default(""),
  rules: text("rules").notNull().default(""),
  disclosurePolicy: text("disclosure_policy").notNull().default(""),
  status: text("status", { enum: ["draft", "published", "paused", "archived"] })
    .notNull()
    .default("draft"),
  eligibility: text("eligibility", {
    enum: ["all", "organization", "invitation"],
  })
    .notNull()
    .default("organization"),
  leaderboardVisibility: text("leaderboard_visibility", {
    enum: ["members", "hidden"],
  })
    .notNull()
    .default("members"),
  scoring: jsonb("scoring")
    .$type<
      Partial<Record<"none" | "low" | "medium" | "high" | "critical", number>>
    >()
    .notNull()
    .default({ none: 0, low: 50, medium: 200, high: 500, critical: 1000 }),
});

export const programMemberships = pgTable(
  "program_memberships",
  {
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", {
      enum: ["manager", "triager", "researcher"],
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.programId, table.userId, table.role] }),
  ],
);

export const programScopes = pgTable("program_scopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  targetType: text("target_type", {
    enum: ["host", "ip", "cidr", "url", "other"],
  })
    .notNull()
    .default("other"),
  target: text("target").notNull().default(""),
  inScope: boolean("in_scope").notNull().default(true),
});

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: integer("number").generatedAlwaysAsIdentity().unique(),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id),
  assetId: uuid("asset_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  cwe: text("cwe").notNull(),
  steps: text("steps").notNull(),
  proofOfConcept: text("proof_of_concept").notNull().default(""),
  impact: text("impact").notNull(),
  proposedSeverity: text("proposed_severity", {
    enum: ["none", "low", "medium", "high", "critical"],
  }).notNull(),
  severity: text("severity", {
    enum: ["none", "low", "medium", "high", "critical"],
  }),
  contentRedactedAt: date("content_redacted_at"),
  reproVerified: boolean("repro_verified").notNull().default(false),
  cvssVector: text("cvss_vector"),
  cvssScore: real("cvss_score"),
  assigneeId: uuid("assignee_id").references(() => users.id),
  status: text("status", {
    enum: [
      "submitted",
      "triage",
      "validated",
      "remediation",
      "retesting",
      "resolved",
      "needs_information",
      "duplicate",
      "informative",
      "out_of_scope",
      "not_applicable",
    ],
  })
    .notNull()
    .default("submitted"),
  duplicateOfId: uuid("duplicate_of_id"),
  createdAt: date("created_at").notNull().defaultNow(),
  updatedAt: date("updated_at").notNull().defaultNow(),
});

export const reportComments = pgTable("report_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  internal: boolean("internal").notNull().default(false),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const reportEvents = pgTable("report_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(),
  details: jsonb("details")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  internal: boolean("internal").notNull().default(false),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const reportAttachments = pgTable("report_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  storageKey: uuid("storage_key").notNull().defaultRandom().unique(),
  mediaType: text("media_type").notNull(),
  size: integer("size").notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const scoreEvents = pgTable("score_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id").notNull(),
  programId: uuid("program_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind", { enum: ["award", "correction"] }).notNull(),
  points: integer("points").notNull(),
  awardSeverity: text("award_severity", {
    enum: ["none", "low", "medium", "high", "critical"],
  }),
  reason: text("reason").notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startsAt: date("starts_at").notNull(),
  endsAt: date("ends_at").notNull(),
});

export const achievements = pgTable("achievements", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  minimumValidated: integer("minimum_validated").notNull(),
});

export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  minimumPoints: integer("minimum_points").notNull(),
});

export const notificationChannels = pgTable("notification_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id),
  kind: text("kind", { enum: ["smtp", "webhook"] }).notNull(),
  destination: text("destination").notNull(),
  signingSecret: text("signing_secret"),
  enabled: boolean("enabled").notNull().default(true),
  subscribedEvents: text("subscribed_events")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  severities: text("severities")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

export const notificationOutbox = pgTable("notification_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull(),
  channelId: uuid("channel_id").notNull(),
  eventType: text("event_type").notNull(),
  reportId: uuid("report_id"),
  severity: text("severity", {
    enum: ["none", "low", "medium", "high", "critical"],
  }),
  publicReportId: text("public_report_id"),
  createdAt: date("created_at").notNull().defaultNow(),
  availableAt: date("available_at").notNull().defaultNow(),
  status: text("status", { enum: ["pending", "delivered", "dead"] })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  retryCount: integer("retry_count").notNull().default(0),
});

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  outboxId: uuid("outbox_id")
    .notNull()
    .references(() => notificationOutbox.id),
  attempt: integer("attempt").notNull(),
  result: text("result").notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgUnits.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(),
  details: jsonb("details")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const platformSettings = pgTable("platform_settings", {
  singleton: boolean("singleton").primaryKey().default(true),
  reportExports: boolean("report_exports").notNull().default(true),
  globalLeaderboard: boolean("global_leaderboard").notNull().default(true),
});

export const integrationAudit = pgTable("integration_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  actorType: text("actor_type", { enum: ["delegated", "service"] }).notNull(),
  clientId: text("client_id").notNull(),
  operation: text("operation").notNull(),
  resourceId: text("resource_id"),
  programId: uuid("program_id"),
  organizationId: uuid("organization_id"),
  requestId: uuid("request_id").notNull(),
  outcome: integer("outcome").notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  locale: text("locale", { enum: ["en", "de"] }),
  theme: text("theme", { enum: ["light", "dark"] }),
});
