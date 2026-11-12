import assert from "node:assert/strict";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";
import { accounts, authUsers, sessions } from "./schema";

const connectionString = process.env.RLS_TEST_DATABASE_URL;

test.skipIf(!connectionString)(
  "the runtime role can persist and revoke an Auth.js session",
  async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE bossob_app");

      const adapter = DrizzleAdapter(drizzle(client), {
        usersTable: authUsers,
        accountsTable: accounts,
        sessionsTable: sessions,
      });
      assert(
        adapter.createUser &&
          adapter.linkAccount &&
          adapter.getUserByAccount &&
          adapter.createSession &&
          adapter.getSessionAndUser &&
          adapter.deleteSession,
      );
      const subject = randomUUID();
      const token = randomUUID();
      const email = `${subject}@example.invalid`;
      const user = await adapter.createUser({
        id: subject,
        name: "Local fixture",
        email,
        emailVerified: null,
      });
      await adapter.linkAccount({
        userId: user.id,
        type: "oidc",
        provider: "test",
        providerAccountId: subject,
      });
      expect(
        await adapter.getUserByAccount({
          provider: "test",
          providerAccountId: subject,
        }),
      ).toEqual(user);

      await adapter.createSession({
        userId: user.id,
        sessionToken: token,
        expires: new Date(Date.now() + 60000),
      });
      expect((await adapter.getSessionAndUser(token))?.user.id).toBe(user.id);
      await adapter.deleteSession(token);
      expect(await adapter.getSessionAndUser(token)).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);
