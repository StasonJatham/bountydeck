import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const db = drizzle(process.env.DATABASE_URL ?? "", { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function withActor<T>(
  actorId: string,
  callback: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
    return callback(tx);
  });
}
