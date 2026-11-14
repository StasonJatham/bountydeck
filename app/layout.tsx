import { SiteFooter } from "../components/site-footer";
import localFont from "next/font/local";
import { getI18n } from "../lib/i18n";
import { getPreferences, preferenceSession } from "../lib/preferences";
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
  const { theme, locale } = await getPreferences();
  const signedIn = Boolean((await preferenceSession())?.actorId);
  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${geist.variable} ${mono.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        {children}
        <SiteFooter signedIn={signedIn} />
      </body>
    </html>
  );
}
