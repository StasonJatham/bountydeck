import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db";
import {
  orgMemberships,
  orgUnits,
  programMemberships,
  programs,
  programScopes,
  rewards,
  scoreEvents,
  users,
} from "../../db/schema";
import { IntegrationError } from "./errors";
import type { IntegrationPrincipal } from "./auth";

const uuid = z.uuid();
export const pageInput = z.object({
  cursor: uuid.optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export const programListInput = pageInput.extend({
  organizationId: uuid.optional(),
  search: z.string().trim().max(100).optional(),
});

function page<T extends { id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}

export function identity(principal: IntegrationPrincipal) {
  const { actorId, actorType, clientId } = principal;
  return withActor(actorId, async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        name: users.name,
        platformRole: users.platformRole,
      })
      .from(users)
      .where(eq(users.id, actorId));
    const organizationRoles = await tx
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.userId, actorId))
      .limit(1000);
    const programRoles = await tx
      .select()
      .from(programMemberships)
      .where(eq(programMemberships.userId, actorId))
      .limit(1000);
    return { ...user, actorType, clientId, organizationRoles, programRoles };
  });
}

export function listOrganizations(
  actor: string,
  input: z.infer<typeof pageInput>,
) {
  return withActor(actor, async (tx) =>
    page(
      await tx
        .select()
        .from(orgUnits)
        .where(input.cursor ? gt(orgUnits.id, input.cursor) : undefined)
        .orderBy(orgUnits.id)
        .limit(input.limit + 1),
      input.limit,
    ),
  );
}

export function getOrganization(actor: string, id: string) {
  return withActor(actor, async (tx) => {
    const [organization] = await tx
      .select()
      .from(orgUnits)
      .where(eq(orgUnits.id, id));
    if (!organization) throw new IntegrationError(404, "not_found");
    return organization;
  });
}

export function listPrograms(
  actor: string,
  input: z.infer<typeof programListInput>,
) {
  return withActor(actor, async (tx) =>
    page(
      await tx
        .select({
          id: programs.id,
          name: programs.name,
          slug: programs.slug,
          organizationId: programs.orgId,
          status: programs.status,
          eligibility: programs.eligibility,
          canSubmit: sql<boolean>`app_can_submit(${programs.id})`,
          canReview: sql<boolean>`app_reviews_program(${programs.id})`,
          canManage: sql<boolean>`app_manages_program(${programs.id})`,
        })
        .from(programs)
        .where(
          and(
            input.organizationId
              ? eq(programs.orgId, input.organizationId)
              : undefined,
            input.cursor ? gt(programs.id, input.cursor) : undefined,
            input.search
              ? sql`strpos(lower(${programs.name}), lower(${input.search})) > 0`
              : undefined,
          ),
        )
        .orderBy(programs.id)
        .limit(input.limit + 1),
      input.limit,
    ),
  );
}

export function getProgram(actor: string, id: string) {
  return withActor(actor, async (tx) => {
    const [program] = await tx
      .select({
        program: programs,
        canViewRules: sql<boolean>`app_can_view_program(${programs.id})`,
        canSubmit: sql<boolean>`app_can_submit(${programs.id})`,
        canReview: sql<boolean>`app_reviews_program(${programs.id})`,
        canManage: sql<boolean>`app_manages_program(${programs.id})`,
      })
      .from(programs)
      .where(eq(programs.id, id));
    if (!program) throw new IntegrationError(404, "not_found");
    const {
      program: { rules, disclosurePolicy, ...metadata },
      canViewRules,
      ...permissions
    } = program;
    const scope = await tx
      .select()
      .from(programScopes)
      .where(eq(programScopes.programId, id))
      .orderBy(programScopes.id)
      .limit(200);
    const programRewards = await tx
      .select()
      .from(rewards)
      .where(eq(rewards.programId, id))
      .orderBy(rewards.id)
      .limit(200);
    return {
      ...metadata,
      ...(canViewRules ? { rules, disclosurePolicy } : {}),
      ...permissions,
      scope,
      rewards: programRewards,
    };
  });
}

export function scoreHistory(actor: string, input: z.infer<typeof pageInput>) {
  return withActor(actor, async (tx) =>
    page(
      await tx
        .select()
        .from(scoreEvents)
        .where(
          and(
            eq(scoreEvents.userId, actor),
            input.cursor ? gt(scoreEvents.id, input.cursor) : undefined,
          ),
        )
        .orderBy(scoreEvents.id)
        .limit(input.limit + 1),
      input.limit,
    ),
  );
}

export const membershipListInput = z.object({
  afterUser: uuid.optional(),
  afterRole: z
    .enum(["admin", "member", "oversight", "manager", "triager", "researcher"])
    .optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
type MembershipList = z.infer<typeof membershipListInput>;

function membershipPage<T extends { userId: string; role: string }>(
  rows: T[],
  limit: number,
) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      last && rows.length > limit
        ? { afterUser: last.userId, afterRole: last.role }
        : null,
  };
}

export function listOrganizationMemberships(
  actor: string,
  id: string,
  input: MembershipList,
) {
  return withActor(actor, async (tx) => {
    if (Boolean(input.afterUser) !== Boolean(input.afterRole))
      throw new IntegrationError(422, "invalid_cursor");
    const [org] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.id, id),
          sql`(app_org_admin(${orgUnits.id}) or app_platform_admin())`,
        ),
      );
    if (!org) throw new IntegrationError(404, "not_found");
    const rows = await tx
      .select()
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.orgId, id),
          input.afterUser && input.afterRole
            ? sql`(${orgMemberships.userId}, ${orgMemberships.role}) > (${input.afterUser}::uuid, ${input.afterRole}::text)`
            : undefined,
        ),
      )
      .orderBy(orgMemberships.userId, orgMemberships.role)
      .limit(input.limit + 1);
    return membershipPage(rows, input.limit);
  });
}

export function listProgramMemberships(
  actor: string,
  id: string,
  input: MembershipList,
) {
  return withActor(actor, async (tx) => {
    if (Boolean(input.afterUser) !== Boolean(input.afterRole))
      throw new IntegrationError(422, "invalid_cursor");
    const [program] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(
        and(eq(programs.id, id), sql`app_manages_program(${programs.id})`),
      );
    if (!program) throw new IntegrationError(404, "not_found");
    const rows = await tx
      .select()
      .from(programMemberships)
      .where(
        and(
          eq(programMemberships.programId, id),
          input.afterUser && input.afterRole
            ? sql`(${programMemberships.userId}, ${programMemberships.role}) > (${input.afterUser}::uuid, ${input.afterRole}::text)`
            : undefined,
        ),
      )
      .orderBy(programMemberships.userId, programMemberships.role)
      .limit(input.limit + 1);
    return membershipPage(rows, input.limit);
  });
}
