import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Brand } from "../../components/brand";
import { LocaleControl } from "../../components/locale-control";
import { ThemeControl } from "../../components/theme-control";
import { guestReportsEnabled } from "../../lib/guest-reports";
import { getI18n } from "../../lib/i18n";

export default async function GuestReportLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!guestReportsEnabled()) notFound();
  const { t } = await getI18n();
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-5">
        <Link href="/" aria-label={t("Home")}>
          <Brand />
        </Link>
        <div className="flex gap-2">
          <LocaleControl />
          <ThemeControl />
        </div>
      </header>
      {children}
    </main>
  );
}
