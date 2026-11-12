import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const db = drizzle(process.env.DATABASE_URL ?? "", { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const actorTransaction = new AsyncLocalStorage<{ actorId: string; tx: Tx }>();

export function withActor<T>(
  actorId: string,
  callback: (tx: Tx) => Promise<T>,
): Promise<T> {
  const current = actorTransaction.getStore();
  if (current) {
    if (current.actorId !== actorId)
      throw new Error("Cannot change actor inside an active transaction");
    return callback(current.tx);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
    return callback(tx);
  });
}

export function withActorTransaction<T>(
  actorId: string,
  callback: (tx: Tx) => Promise<T>,
) {
  return withActor(actorId, (tx) =>
    actorTransaction.run({ actorId, tx }, () => callback(tx)),
  );
}
