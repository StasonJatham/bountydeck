import Link from "next/link";
import { AchievementAdministration } from "./achievement-review";
import { getI18n } from "../lib/i18n";
import { Button } from "./ui/button";
import { desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { withActor } from "../db";
import {
  auditEvents,
  orgMemberships,
  orgUnits,
  platformSettings,
  users,
} from "../db/schema";
import { requireActor } from "../lib/actor";
import { Field, input, panel, Text } from "../lib/forms";
import {
  createOrganization,
  createProgram,
  setOrgRole,
  updateOrganization,
  updatePlatformSettings,
} from "../lib/management";

export async function OrganizationAdministration({
  searchParams,
  platformOnly,
}: {
  searchParams: Promise<{ error?: string; achievement?: string }>;
  platformOnly: boolean;
}) {
  const { t, date } = await getI18n();
  const actor = await requireActor();
  const { platform, organizations, events, members, settings } =
    await withActor(actor, async (tx) => {
      const { platform } = (
        await tx.execute<{ platform: boolean }>(
          sql`select app_platform_admin() as platform`,
        )
      ).rows[0];
      if (platformOnly && !platform) notFound();
      const organizations = await tx
        .select({
          id: orgUnits.id,
          name: orgUnits.name,
          slug: orgUnits.slug,
          description: orgUnits.description,
          admin: sql<boolean>`app_org_admin(${orgUnits.id})`,
        })
        .from(orgUnits)
        .where(platformOnly ? undefined : sql`app_org_admin(${orgUnits.id})`)
        .orderBy(orgUnits.name);
      if (!platformOnly && !organizations.length) notFound();
      const events = await tx
        .select()
        .from(auditEvents)
        .orderBy(desc(auditEvents.createdAt))
        .limit(30);
      const members = await tx
        .select({
          orgId: orgMemberships.orgId,
          userId: orgMemberships.userId,
          role: orgMemberships.role,
          name: users.name,
        })
        .from(orgMemberships)
        .innerJoin(users, eq(orgMemberships.userId, users.id));
      const [settings] = await tx.select().from(platformSettings);
      return {
        platform: platformOnly,
        organizations,
        events,
        members,
        settings,
      };
    });
  const { error, achievement } = await searchParams;
  const returnTo = platformOnly ? "/admin" : "/organizations";
  const managed = organizations.filter(({ admin }) => admin);
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        {t(platformOnly ? "Administration" : "Organization management")}
      </h1>
      {platform && (
        <Link
          href="/admin/users"
          className="mt-3 inline-block text-accent underline"
        >
          {t("User management")}
        </Link>
      )}
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {t("Check the details and choose a unique slug.")}
        </p>
      )}
      <div className="mt-6 grid items-start gap-4 md:grid-cols-2">
        {platform && <AchievementAdministration result={achievement} />}
        {platform && (
          <form className={`${panel} grid gap-3`} action={createOrganization}>
            <h2 className="font-semibold">{t("Create organization")}</h2>
            <Text name="name" label={t("Name")} max={100} />
            <Text name="slug" label={t("Slug")} max={80} />
            <Text
              name="description"
              label={t("Description")}
              multiline
              required={false}
            />
            <Button>{t("Create organization")}</Button>
          </form>
        )}
        {managed.length > 0 && (
          <form
            className={`${panel} grid gap-3`}
            action={createProgram.bind(null, returnTo)}
          >
            <h2 className="font-semibold">{t("Create program")}</h2>
            <Field label={t("Organization")}>
              <select name="orgId" className={input}>
                {managed.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </Field>
            <Text name="name" label={t("Name")} max={100} />
            <Text name="slug" label={t("Slug")} max={80} />
            <Text
              name="description"
              label={t("Description")}
              multiline
              required={false}
            />
            <Button>{t("Create program")}</Button>
          </form>
        )}
        {organizations.length > 0 && (
          <form
            className={`${panel} grid gap-3`}
            action={setOrgRole.bind(null, returnTo)}
          >
            <h2 className="font-semibold">{t("Organization access")}</h2>
            <Field label={t("Organization")}>
              <select name="orgId" className={input}>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </Field>
            <Text name="userId" label={t("User ID")} max={36} />
            <Field label={t("Role")}>
              <select name="role" className={input}>
                <option value="member">{t("member")}</option>
                <option value="admin">{t("admin")}</option>
                {platform && (
                  <option value="oversight">{t("oversight")}</option>
                )}
              </select>
            </Field>
            <div className="flex gap-2">
              <Button name="change" value="grant">
                {t("Grant")}
              </Button>
              <Button name="change" value="revoke">
                {t("Revoke")}
              </Button>
            </div>
          </form>
        )}
        {platform && (
          <form
            className={`${panel} grid gap-3`}
            action={updatePlatformSettings}
          >
            <h2 className="font-semibold">{t("Platform settings")}</h2>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                name="reportExports"
                defaultChecked={settings.reportExports}
              />{" "}
              {t("Allow JSON report exports")}
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                name="globalLeaderboard"
                defaultChecked={settings.globalLeaderboard}
              />{" "}
              {t("Show global leaderboard")}
            </label>
            <Button>{t("Save platform settings")}</Button>
          </form>
        )}
        {platform && (
          <section className={panel}>
            <h2 className="font-semibold">{t("Identity and health")}</h2>
            <p className="mt-2 break-all text-sm">{process.env.OIDC_ISSUER}</p>
            <p className="mt-2 text-sm">{t("Database connected")}</p>
          </section>
        )}
        <section className={panel}>
          <h2 className="font-semibold">{t("Organizations")}</h2>
          <div className="mt-3 divide-y divide-line">
            {organizations.map((org) => (
              <details className="py-3" key={org.id}>
                <summary className="cursor-pointer text-sm font-medium">
                  {org.name}
                </summary>
                <form
                  className="mt-3 grid gap-3"
                  action={updateOrganization.bind(null, returnTo)}
                >
                  <input type="hidden" name="orgId" value={org.id} />
                  <Field label={t("Name")}>
                    <input
                      className={input}
                      name="name"
                      defaultValue={org.name}
                      required
                      maxLength={100}
                    />
                  </Field>
                  <Field label={t("Slug")}>
                    <input
                      className={input}
                      name="slug"
                      defaultValue={org.slug}
                      required
                      maxLength={80}
                    />
                  </Field>
                  <Field label={t("Description")}>
                    <textarea
                      className={input}
                      name="description"
                      defaultValue={org.description}
                      maxLength={10000}
                    />
                  </Field>
                  <Button>{t("Save organization")}</Button>
                </form>
                <ul className="mt-3 space-y-1 text-sm">
                  {members
                    .filter((person) => person.orgId === org.id)
                    .map((person) => (
                      <li key={`${person.userId}-${t(person.role)}`}>
                        {person.name ?? person.userId} · {t(person.role)}
                      </li>
                    ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">{t("Audit history")}</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {events.map((entry) => (
              <li key={entry.id}>
                {t(entry.kind)}{" "}
                <time
                  className="text-muted"
                  dateTime={entry.createdAt.toISOString()}
                >
                  {date(entry.createdAt)}
                </time>
              </li>
            ))}
          </ul>
          {!events.length && (
            <p className="mt-2 text-sm">{t("No audit events.")}</p>
          )}
        </section>
      </div>
    </>
  );
}
