"use server";

import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withActor } from "../../../db";
import { requireActor } from "../../../lib/actor";
import { personalKeyDigest } from "../../../lib/integrations/personal-keys";

export async function createKey(_: string, data: FormData) {
  const actor = await requireActor();
  const name = z.string().trim().min(1).max(80).safeParse(data.get("name"));
  if (!name.success) return "";
  const key = `bdk_${randomBytes(32).toString("base64url")}`;
  await withActor(actor, (tx) =>
    tx.execute(sql`
    insert into personal_api_keys (user_id, name, digest)
    values (${actor}, ${name.data}, ${personalKeyDigest(key)})
  `),
  );
  revalidatePath("/integrations");
  return key;
}

export async function revokeKey(data: FormData) {
  const actor = await requireActor();
  const id = z.uuid().safeParse(data.get("id"));
  if (!id.success) return;
  await withActor(actor, (tx) =>
    tx.execute(sql`
    delete from personal_api_keys where id = ${id.data} and user_id = ${actor}
  `),
  );
  revalidatePath("/integrations");
}
