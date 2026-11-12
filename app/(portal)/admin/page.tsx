import { Button } from "../../../components/ui/button";
import { desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { withActor } from "../../../db";
import {
  auditEvents,
  orgMemberships,
  orgUnits,
  platformSettings,
  users,
} from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { Field, input, panel, Text } from "../../../lib/forms";
import {
  createOrganization,
  createProgram,
  setOrgRole,
  updateOrganization,
  updatePlatformSettings,
} from "../../../lib/management";

export default async function Administration({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { platform, organizations, events, members, settings } =
    await withActor(actor, async (tx) => {
      const { platform } = (
        await tx.execute<{ platform: boolean }>(
          sql`select app_platform_admin() as platform`,
        )
      ).rows[0];
      const organizations = await tx
        .select({
          id: orgUnits.id,
          name: orgUnits.name,
          slug: orgUnits.slug,
          description: orgUnits.description,
          admin: sql<boolean>`app_org_admin(${orgUnits.id})`,
        })
        .from(orgUnits)
        .where(sql`app_platform_admin() or app_org_admin(${orgUnits.id})`)
        .orderBy(orgUnits.name);
      if (!platform && !organizations.length) notFound();
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
      return { platform, organizations, events, members, settings };
    });
  const managed = organizations.filter(({ admin }) => admin);
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Administration</h1>
      {(await searchParams).error && (
        <p role="alert" className="mt-4 text-red-800">
          Check the details and choose a unique slug.
        </p>
      )}
      <div className="mt-6 grid items-start gap-4 md:grid-cols-2">
        {platform && (
          <form className={`${panel} grid gap-3`} action={createOrganization}>
            <h2 className="font-semibold">Create organization</h2>
            <Text name="name" label="Name" max={100} />
            <Text name="slug" label="Slug" max={80} />
            <Text
              name="description"
              label="Description"
              multiline
              required={false}
            />
            <Button>Create organization</Button>
          </form>
        )}
        {managed.length > 0 && (
          <form className={`${panel} grid gap-3`} action={createProgram}>
            <h2 className="font-semibold">Create program</h2>
            <Field label="Organization">
              <select name="orgId" className={input}>
                {managed.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </Field>
            <Text name="name" label="Name" max={100} />
            <Text name="slug" label="Slug" max={80} />
            <Text
              name="description"
              label="Description"
              multiline
              required={false}
            />
            <Button>Create program</Button>
          </form>
        )}
        {organizations.length > 0 && (
          <form className={`${panel} grid gap-3`} action={setOrgRole}>
            <h2 className="font-semibold">Organization access</h2>
            <Field label="Organization">
              <select name="orgId" className={input}>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </Field>
            <Text name="userId" label="User ID" max={36} />
            <Field label="Role">
              <select name="role" className={input}>
                <option>member</option>
                <option>admin</option>
                {platform && <option>oversight</option>}
              </select>
            </Field>
            <div className="flex gap-2">
              <Button name="change" value="grant">
                Grant
              </Button>
              <Button name="change" value="revoke">
                Revoke
              </Button>
            </div>
          </form>
        )}
        {platform && (
          <form
            className={`${panel} grid gap-3`}
            action={updatePlatformSettings}
          >
            <h2 className="font-semibold">Platform settings</h2>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                name="reportExports"
                defaultChecked={settings.reportExports}
              />{" "}
              Allow JSON report exports
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                name="globalLeaderboard"
                defaultChecked={settings.globalLeaderboard}
              />{" "}
              Show global leaderboard
            </label>
            <Button>Save platform settings</Button>
          </form>
        )}
        {platform && (
          <section className={panel}>
            <h2 className="font-semibold">Identity and health</h2>
            <p className="mt-2 break-all text-sm">{process.env.OIDC_ISSUER}</p>
            <p className="mt-2 text-sm">Database connected</p>
          </section>
        )}
        <section className={panel}>
          <h2 className="font-semibold">Organizations</h2>
          <div className="mt-3 divide-y divide-neutral-200">
            {organizations.map((org) => (
              <details className="py-3" key={org.id}>
                <summary className="cursor-pointer text-sm font-medium">
                  {org.name}
                </summary>
                <form className="mt-3 grid gap-3" action={updateOrganization}>
                  <input type="hidden" name="orgId" value={org.id} />
                  <Field label="Name">
                    <input
                      className={input}
                      name="name"
                      defaultValue={org.name}
                      required
                      maxLength={100}
                    />
                  </Field>
                  <Field label="Slug">
                    <input
                      className={input}
                      name="slug"
                      defaultValue={org.slug}
                      required
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Description">
                    <textarea
                      className={input}
                      name="description"
                      defaultValue={org.description}
                      maxLength={10000}
                    />
                  </Field>
                  <Button>Save organization</Button>
                </form>
                <ul className="mt-3 space-y-1 text-sm">
                  {members
                    .filter((person) => person.orgId === org.id)
                    .map((person) => (
                      <li key={`${person.userId}-${person.role}`}>
                        {person.name ?? person.userId} · {person.role}
                      </li>
                    ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">Audit history</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {events.map((entry) => (
              <li key={entry.id}>
                {entry.kind}{" "}
                <time
                  className="text-neutral-600"
                  dateTime={entry.createdAt.toISOString()}
                >
                  {entry.createdAt.toISOString().slice(0, 10)}
                </time>
              </li>
            ))}
          </ul>
          {!events.length && <p className="mt-2 text-sm">No audit events.</p>}
        </section>
      </div>
    </>
  );
}
