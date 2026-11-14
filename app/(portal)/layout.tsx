import { and, count, eq, sql } from "drizzle-orm";
import type { ReactNode } from "react";
import {
  PortalShell,
  type NavigationItem,
} from "../../components/portal-shell";
import { withActor } from "../../db";
import { orgUnits, programs, reports, users } from "../../db/schema";
import { requireActor } from "../../lib/actor";
import { signOut } from "../../lib/auth";
import { getI18n } from "../../lib/i18n";

export default async function Portal({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const { t } = await getI18n();
  const { access, organizations, user, attention } = await withActor(
    actor,
    async (tx) => {
      const {
        rows: [access],
      } = await tx.execute<{
        platform: boolean;
        organization: boolean;
        triage: boolean;
      }>(sql`
      select app_platform_admin() as platform,
        exists (select from org_units where app_org_admin(id)) as organization,
        exists (select from programs where app_reviews_program(id)) as triage
    `);
      const organizations = await tx
        .selectDistinct({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .innerJoin(programs, eq(programs.orgId, orgUnits.id))
        .orderBy(orgUnits.name);
      const [user] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, actor));
      const [attention] = await tx
        .select({ total: count() })
        .from(reports)
        .where(
          and(
            eq(reports.reporterId, actor),
            eq(reports.status, "needs_information"),
          ),
        );
      return { access, organizations, user, attention: attention.total };
    },
  );
  const items: NavigationItem[] = [
    { icon: "dashboard", href: "/dashboard", label: t("Dashboard") },
    { icon: "programs", href: "/programs", label: t("Programs") },
    { icon: "reports", href: "/reports", label: t("My reports") },
    { icon: "achievements", href: "/achievements", label: t("Achievements") },
    { icon: "leaderboard", href: "/leaderboard", label: t("Leaderboard") },
    { icon: "profile", href: "/profile", label: t("Researcher profile") },
  ];
  if (access.triage)
    items.push({
      icon: "triage",
      href: "/reports?view=inbox",
      label: t("Triage inbox"),
    });
  if (access.platform)
    items.push({ icon: "admin", href: "/admin", label: t("Administration") });
  else if (access.organization)
    items.push({
      icon: "organizations",
      href: "/organizations",
      label: t("Organizations"),
    });
  items.push({ icon: "settings", href: "/settings", label: t("Settings") });

  return (
    <PortalShell
      items={items}
      organizations={organizations}
      user={user?.name ?? ""}
      attention={attention}
      signOut={
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="w-full rounded-md px-2 py-1.5 text-left hover:bg-subtle">
            {t("Sign out")}
          </button>
        </form>
      }
      labels={{
        navigation: t("Main navigation"),
        breadcrumb: t("Breadcrumb"),
        dashboard: t("Dashboard"),
        organization: t("Organization"),
        allOrganizations: t("All organizations"),
        collapse: t("Collapse navigation"),
        expand: t("Expand navigation"),
        open: t("Open navigation"),
        close: t("Close navigation"),
        account: t("Account menu"),
        profile: t("Profile"),
        settings: t("Settings"),
        notifications: t("Notifications"),
        programDetails: t("Program details"),
        programSettings: t("Program settings"),
        reportDetails: t("Report details"),
        skip: t("Skip to content"),
      }}
    >
      {children}
    </PortalShell>
  );
}
