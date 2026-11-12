import { and, asc, eq, exists } from "drizzle-orm";
import { withActor, type Tx } from "../db";
import { programs, programScopes } from "../db/schema";

export const guestReporterId = "00000000-0000-4000-8000-000000000010";

export function guestReportsEnabled() {
  return process.env.BOUNTYDECK_GUEST_REPORTS === "true";
}

export function guestProgramFilter() {
  return and(eq(programs.status, "published"), eq(programs.eligibility, "all"));
}

export function guestPrograms(tx: Tx, id?: string) {
  return tx
    .select({ id: programs.id, name: programs.name, rules: programs.rules })
    .from(programs)
    .where(
      and(
        guestProgramFilter(),
        id ? eq(programs.id, id) : undefined,
        exists(
          tx
            .select({ id: programScopes.id })
            .from(programScopes)
            .where(
              and(
                eq(programScopes.programId, programs.id),
                eq(programScopes.inScope, true),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(programs.name), asc(programs.id));
}

export function getGuestPrograms() {
  return withActor(guestReporterId, (tx) => guestPrograms(tx));
}
