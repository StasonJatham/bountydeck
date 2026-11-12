import localFont from "next/font/local";
import { getI18n } from "../lib/i18n";
import { cookies } from "next/headers";
import { parseTheme, themeCookie } from "../lib/theme";
import type { ReactNode } from "react";
import "./style.css";

const geist = localFont({
  src: "./fonts/Geist.woff2",
  variable: "--geist-sans",
  weight: "100 900",
  display: "swap",
});
const mono = localFont({
  src: "./fonts/GeistMono.woff2",
  variable: "--geist-mono",
  weight: "100 900",
  display: "swap",
});

export async function generateMetadata() {
  const { t } = await getI18n();
  return {
    title: "BountyDeck",
    description: t("Find vulnerabilities. Earn recognition."),
  };
}

export default async function Layout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(themeCookie)?.value);
  const { locale } = await getI18n();
  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${geist.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
