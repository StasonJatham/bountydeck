import { sql } from "drizzle-orm";
import { withActor } from "../../db";
import { Shield } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireActor } from "../../lib/actor";
import { signOut } from "../../lib/auth";

export default async function Portal({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const { administer } = await withActor(
    actor,
    async (tx) =>
      (
        await tx.execute<{ administer: boolean }>(
          sql`select app_platform_admin() or exists (select from org_units where app_org_admin(id)) as administer`,
        )
      ).rows[0],
  );
  return (
    <>
      <header className="border-b border-neutral-200 bg-white">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 text-sm"
        >
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold"
          >
            <Shield size={19} aria-hidden /> Bossob
          </Link>
          <Link href="/programs">Programs</Link>
          <Link href="/reports">Reports</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/profile">Profile</Link>
          {administer && <Link href="/admin">Administration</Link>}
          <form
            className="ml-auto"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="rounded-md border border-neutral-300 px-3 py-1.5">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>
    </>
  );
}
