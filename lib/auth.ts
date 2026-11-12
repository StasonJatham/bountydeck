import { parseTheme, themeCookie } from "./theme";
import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { readFileSync } from "node:fs";
import { db } from "../db";
import { authUsers, accounts, sessions } from "../db/schema";

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
  const theme = parseTheme(request?.cookies.get(themeCookie)?.value);
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
      session({ session, user }) {
        return { ...session, actorId: user.id };
      },
    },
  };
});
