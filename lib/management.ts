"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "./actor";
import { IntegrationError } from "./integrations/errors";
import {
  performCreateOrganization,
  organizationInput,
  performSetOrgRole,
  organizationRoleInput,
  performCreateProgram,
  programCreateInput,
  performUpdateProgram,
  programInput,
  performAddScope,
  scopeInput,
  performSetProgramRole,
  programRoleInput,
  performJoinProgram,
  performAddReward,
  rewardInput,
  performUpdateOrganization,
  organizationUpdateInput,
  performUpdateScope,
  performUpdatePlatformSettings,
} from "./integrations/management";
const uuid = z.uuid();

function parsePoints(value: FormDataEntryValue | null) {
  return typeof value === "string" && /^\d{1,6}$/.test(value)
    ? Number(value)
    : undefined;
}

async function webOperation<T>(call: () => Promise<T>, conflict?: string) {
  try {
    return await call();
  } catch (error) {
    if (error instanceof IntegrationError && error.status === 404) notFound();
    if (
      error instanceof IntegrationError &&
      [409, 422].includes(error.status) &&
      conflict
    )
      redirect(conflict);
    throw error;
  }
}

export async function createOrganization(data: FormData) {
  const actor = await requireActor();
  const parsed = organizationInput.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect("/admin?error=invalid");
  await webOperation(
    () => performCreateOrganization(actor, parsed.data),
    "/admin?error=conflict",
  );
  redirect("/admin");
}

export async function setOrgRole(
  returnTo: "/admin" | "/organizations",
  data: FormData,
) {
  const actor = await requireActor();
  const destination =
    returnTo === "/organizations" ? "/organizations" : "/admin";
  const parsed = organizationRoleInput.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`${destination}?error=invalid`);
  await webOperation(() => performSetOrgRole(actor, parsed.data), undefined);
  redirect(destination);
}

export async function createProgram(
  returnTo: "/admin" | "/organizations",
  data: FormData,
) {
  const actor = await requireActor();
  const destination =
    returnTo === "/organizations" ? "/organizations" : "/admin";
  const parsed = programCreateInput.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`${destination}?error=invalid`);
  const id = await webOperation(
    () => performCreateProgram(actor, parsed.data),
    `${destination}?error=conflict`,
  );
  redirect(`/programs/${id}/manage`);
}

export async function updateProgram(id: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  const fields = Object.fromEntries(data);
  const points = Object.fromEntries(
    ["low", "medium", "high", "critical"].map((key) => [
      key,
      parsePoints(fields[key]),
    ]),
  );
  const parsed = programInput.safeParse({ ...fields, ...points });
  if (!parsed.success) redirect(`/programs/${id}/manage?error=invalid`);
  await webOperation(
    () => performUpdateProgram(actor, id, parsed.data),
    undefined,
  );
  redirect(`/programs/${id}/manage`);
}

export async function addScope(id: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  const parsed = scopeInput.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${id}/manage?error=invalid`);
  await webOperation(
    () => performAddScope(actor, id, parsed.data, data.get("inScope") === "on"),
    `/programs/${id}/manage?error=invalid`,
  );
  redirect(`/programs/${id}/manage`);
}

export async function setProgramRole(id: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  const parsed = programRoleInput.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${id}/manage?error=invalid`);
  await webOperation(
    () => performSetProgramRole(actor, id, parsed.data),
    undefined,
  );
  redirect(`/programs/${id}/manage`);
}

export async function joinProgram(id: string) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  await webOperation(() => performJoinProgram(actor, id), undefined);
  redirect(`/programs/${id}`);
}

export async function addReward(id: string, data: FormData) {
  const actor = await requireActor();
  if (!uuid.safeParse(id).success) notFound();
  const parsed = rewardInput.safeParse({
    ...Object.fromEntries(data),
    minimumPoints: parsePoints(data.get("minimumPoints")),
  });
  if (!parsed.success) redirect(`/programs/${id}/manage?error=invalid`);
  await webOperation(() => performAddReward(actor, id, parsed.data), undefined);
  redirect(`/programs/${id}/manage`);
}

export async function updateOrganization(
  returnTo: "/admin" | "/organizations",
  data: FormData,
) {
  const actor = await requireActor();
  const destination =
    returnTo === "/organizations" ? "/organizations" : "/admin";
  const parsed = organizationUpdateInput.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`${destination}?error=invalid`);
  await webOperation(
    () => performUpdateOrganization(actor, parsed.data),
    undefined,
  );
  redirect(destination);
}

export async function updateScope(
  programId: string,
  scopeId: string,
  data: FormData,
) {
  const actor = await requireActor();
  if (!uuid.safeParse(programId).success || !uuid.safeParse(scopeId).success)
    notFound();
  const parsed = scopeInput.safeParse(Object.fromEntries(data));
  if (!parsed.success) redirect(`/programs/${programId}/manage?error=invalid`);
  await webOperation(
    () =>
      performUpdateScope(
        actor,
        programId,
        scopeId,
        parsed.data,
        data.get("inScope") === "on",
      ),
    `/programs/${programId}/manage?error=invalid`,
  );
  redirect(`/programs/${programId}/manage`);
}

export async function updatePlatformSettings(data: FormData) {
  const actor = await requireActor();
  const settings = {
    reportExports: data.get("reportExports") === "on",
    globalLeaderboard: data.get("globalLeaderboard") === "on",
  };
  await webOperation(
    () => performUpdatePlatformSettings(actor, settings),
    undefined,
  );
  redirect("/admin");
}
