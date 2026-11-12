import { cache } from "react";
import { cookies } from "next/headers";
import { german } from "./messages-de";

export const localeCookie = "bossob-locale";
export type Locale = "en" | "de";

export function translator(locale: Locale) {
  return (message: string, values: Record<string, string | number> = {}) =>
    (locale === "de" && Object.hasOwn(german, message)
      ? german[message]
      : message
    ).replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      String(values[name] ?? placeholder),
    );
}

export const getI18n = cache(async () => {
  const locale: Locale =
    (await cookies()).get(localeCookie)?.value === "de" ? "de" : "en";
  const language = locale === "de" ? "de-DE" : "en-GB";
  const date = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const dateTime = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const decimal = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const number = new Intl.NumberFormat(language);
  return {
    locale,
    decimal: (value: number) => decimal.format(value),
    t: translator(locale),
    date: (value: Date) => date.format(value),
    dateTime: (value: Date) => dateTime.format(value),
    number: (value: string | number | bigint) =>
      number.format(typeof value === "string" ? BigInt(value) : value),
  };
});
