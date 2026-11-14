import { getBranding } from "../lib/branding";
import { SiteFooter } from "../components/site-footer";
import localFont from "next/font/local";
import { getI18n } from "../lib/i18n";
import { getPreferences, preferenceSession } from "../lib/preferences";
import type { CSSProperties, ReactNode } from "react";
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
  const brand = await getBranding();
  return {
    title: brand.name,
    icons: { icon: brand.logo },
    description: t("Find vulnerabilities. Earn recognition."),
  };
}

export default async function Layout({ children }: { children: ReactNode }) {
  const { theme, locale } = await getPreferences();
  const brand = await getBranding();
  const signedIn = Boolean((await preferenceSession())?.actorId);
  return (
    <html
      lang={locale}
      style={
        brand.accent
          ? ({
              "--brand-accent": brand.accent,
              "--brand-foreground": brand.foreground,
              "--brand-link-light":
                "color-mix(in srgb, var(--brand-accent), #000 55%)",
              "--brand-link-dark":
                "color-mix(in srgb, var(--brand-accent), #fff 55%)",
            } as CSSProperties)
          : undefined
      }
      data-theme={theme}
      className={`${geist.variable} ${mono.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        {children}
        <SiteFooter signedIn={signedIn} brandName={brand.name} />
      </body>
    </html>
  );
}
