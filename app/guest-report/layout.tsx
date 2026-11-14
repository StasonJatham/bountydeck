import { getBranding } from "../../lib/branding";
import { SiteHeader } from "../../components/site-header";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { guestReportsEnabled } from "../../lib/guest-reports";

export default async function GuestReportLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!guestReportsEnabled()) notFound();
  return (
    <>
      <SiteHeader brand={await getBranding()} />
      <main className="mx-auto max-w-3xl space-y-6 px-6 pb-12">{children}</main>
    </>
  );
}
