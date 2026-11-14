"use server";

import { sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import { requireActor } from "./actor";

export async function deleteRecord(
  kind: "program" | "report",
  id: string,
  data: FormData,
) {
  const actor = await requireActor();
  if (!z.uuid().safeParse(id).success || !["program", "report"].includes(kind))
    notFound();
  const path = kind === "program" ? `/programs/${id}/manage` : `/reports/${id}`;
  if (data.get("confirm") !== "yes") redirect(path);
  try {
    const {
      rows: [result],
    } = await withActor(actor, (tx) =>
      tx.execute<{ deleted: boolean }>(
        sql`select admin_delete_record(${kind}, ${id}::uuid) as deleted`,
      ),
    );
    if (!result.deleted) notFound();
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    if (
      typeof cause === "object" &&
      cause &&
      "code" in cause &&
      cause.code === "23503"
    ) {
      redirect(path + "?error=delete-blocked");
    }
    throw error;
  }
  redirect(kind === "program" ? "/programs" : "/reports");
}
