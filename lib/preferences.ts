import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { withActor } from "../db";
import { userPreferences } from "../db/schema";
import { auth } from "./auth";
import { readTheme, themeCookie } from "./theme";

export const localeCookie = "bountydeck-locale";
export type Locale = "en" | "de";

export const preferenceSession = cache(async () => auth());

export const getPreferences = cache(async () => {
  const [jar, session] = await Promise.all([cookies(), preferenceSession()]);
  const actor = session?.actorId;
  const [saved] = actor
    ? await withActor(actor, (tx) =>
        tx
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.userId, actor)),
      )
    : [];
  const locale: Locale =
    (jar.get(localeCookie)?.value ?? jar.get("bossob-locale")?.value) === "de"
      ? "de"
      : "en";
  return {
    locale: saved?.locale ?? locale,
    theme: saved?.theme ?? readTheme(jar),
  };
});

export async function savePreference(
  preference: { locale: Locale } | { theme: "light" | "dark" },
) {
  const actor = (await auth())?.actorId;
  if (actor) {
    await withActor(actor, (tx) =>
      tx
        .insert(userPreferences)
        .values({ userId: actor, ...preference })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: preference,
        }),
    );
  }
  const [name, value] =
    "locale" in preference
      ? [localeCookie, preference.locale]
      : [themeCookie, preference.theme];
  (await cookies()).set(name, value, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 31536000,
    secure: process.env.AUTH_URL?.startsWith("https:"),
  });
}
