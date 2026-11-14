import { eq } from "drizzle-orm";
import { logEvent } from "./telemetry/logger";
import { readTheme } from "./theme";
import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { readFileSync } from "node:fs";
import { db } from "../db";
import { authUsers, accounts, sessions, users } from "../db/schema";

function secret(name: string) {
  const path = process.env[`${name}_FILE`];
  return path ? readFileSync(path, "utf8").trim() : process.env[name];
}

declare module "next-auth" {
  interface Session {
    actorId: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth((request) => {
  const theme = readTheme(request?.cookies);
  const issuer = process.env.OIDC_ISSUER;
  const provider = `oidc:${issuer}`;
  const adapter = DrizzleAdapter(db, {
    usersTable: authUsers,
    accountsTable: accounts,
    sessionsTable: sessions,
  });
  return {
    adapter: {
      ...adapter,
      async getSessionAndUser(token) {
        const result = await adapter.getSessionAndUser!(token);
        if (!result) return null;
        const [user] = await db
          .select({ disabled: users.loginDisabled })
          .from(users)
          .where(eq(users.id, result.user.id));
        return user?.disabled ? null : result;
      },
      getUserByAccount: (account) =>
        adapter.getUserByAccount!({ ...account, provider }),
      linkAccount: ({ userId, type, providerAccountId }) =>
        adapter.linkAccount!({ userId, type, providerAccountId, provider }),
      unlinkAccount: (account) =>
        adapter.unlinkAccount!({ ...account, provider }),
      getAccount: (subject) => adapter.getAccount!(subject, provider),
    },
    pages: { signIn: "/sign-in", error: "/sign-in" },
    theme: { colorScheme: theme === "system" ? "auto" : theme },
    secret: secret("AUTH_SECRET"),
    logger: {
      error(error) {
        logEvent({
          service: "application",
          level: "error",
          action: "auth.error",
          message: "Authentication operation failed",
          outcome: "failure",
          errorType: error.name,
        });
      },
      warn(code) {
        logEvent({
          service: "application",
          level: "warn",
          action: "auth.warning",
          message: "Authentication warning",
          errorType: code,
        });
      },
    },
    events: {
      async signIn() {
        logEvent({
          service: "application",
          action: "auth.sign_in",
          message: "Sign-in completed",
          outcome: "success",
        });
      },
      async signOut() {
        logEvent({
          service: "application",
          action: "auth.sign_out",
          message: "Sign-out completed",
          outcome: "success",
        });
      },
    },
    providers: [
      {
        id: "oidc",
        name: "Company account",
        type: "oidc",
        issuer,
        clientId: process.env.OIDC_CLIENT_ID,
        clientSecret: secret("OIDC_CLIENT_SECRET"),
        checks: ["pkce", "state", "nonce"],
      },
    ],
    session: { strategy: "database", maxAge: 8 * 3600 },
    callbacks: {
      async signIn({ account }) {
        if (!account) return false;
        const existing = await adapter.getUserByAccount!({
          provider,
          providerAccountId: account.providerAccountId,
        });
        if (!existing) return true;
        const [user] = await db
          .select({ disabled: users.loginDisabled })
          .from(users)
          .where(eq(users.id, existing.id));
        return !user?.disabled;
      },
      session({ session, user }) {
        return { ...session, actorId: user.id };
      },
    },
  };
});
