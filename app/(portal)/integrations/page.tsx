import { KeyForm } from "./key-form";
import { revokeKey } from "./key-actions";
import { Button } from "../../../components/ui/button";
import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { withActor } from "../../../db";
import { integrationAudit, programs, users } from "../../../db/schema";
import { requireActor } from "../../../lib/actor";
import { panel } from "../../../lib/forms";
import { getI18n } from "../../../lib/i18n";
import { integrationSkills } from "../../../lib/integration-skills";

export default async function Integrations() {
  const actor = await requireActor();
  const { t, dateTime } = await getI18n();
  const { user, permissions, activity, keys } = await withActor(
    actor,
    async (tx) => {
      const [user] = await tx
        .select({ name: users.name, platformRole: users.platformRole })
        .from(users)
        .where(eq(users.id, actor));
      const permissions = await tx
        .select({
          id: programs.id,
          name: programs.name,
          view: sql<boolean>`app_can_view_program(${programs.id})`,
          submit: sql<boolean>`app_can_submit(${programs.id})`,
          triage: sql<boolean>`app_reviews_program(${programs.id})`,
          manage: sql<boolean>`app_manages_program(${programs.id})`,
        })
        .from(programs)
        .where(sql`app_can_view_program(${programs.id})`)
        .orderBy(asc(programs.name), asc(programs.id))
        .limit(50);
      const activity = await tx
        .select({
          id: integrationAudit.id,
          requestId: integrationAudit.requestId,
          actorType: integrationAudit.actorType,
          operation: integrationAudit.operation,
          clientId: integrationAudit.clientId,
          outcome: integrationAudit.outcome,
          createdAt: integrationAudit.createdAt,
        })
        .from(integrationAudit)
        .orderBy(desc(integrationAudit.createdAt))
        .limit(25);
      const { rows: keys } = await tx.execute<{
        id: string;
        name: string;
        expires_at: Date;
      }>(sql`
      select id, name, expires_at from personal_api_keys where user_id = app_actor() order by expires_at desc
    `);
      return { user, permissions, activity, keys };
    },
  );

  const audience = process.env.INTEGRATION_AUDIENCE;
  const scope = process.env.INTEGRATION_SCOPE || "bountydeck.api";
  const origin = process.env.AUTH_URL?.replace(/\/$/, "") ?? "";
  const endpoints: [string, string | undefined][] = [
    ["REST API", `${origin}/api/v1`],
    ["MCP endpoint", `${origin}/mcp`],
    ["Token audience", audience],
    ["Required scope", audience ? scope : undefined],
  ];
  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("Integrations")}
      </h1>
      <section className={`${panel} space-y-3`}>
        <h2 className="font-semibold">{t("Personal API keys")}</h2>
        <p className="text-sm text-muted">
          {t(
            "Use the key as a Bearer token for REST and MCP. It uses your current permissions and expires after 90 days.",
          )}
        </p>
        <KeyForm
          name={t("Key name")}
          create={t("Create key")}
          copy={t("Copy this key now. It is shown only once.")}
        />
        {keys.map((key) => (
          <form
            action={revokeKey}
            key={key.id}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <input type="hidden" name="id" value={key.id} />
            <span>
              {key.name} · {dateTime(key.expires_at)}
            </span>
            <Button variant="outline">{t("Revoke key")}</Button>
          </form>
        ))}
      </section>
      <section className={panel}>
        <h2 className="font-semibold">{t("Connect a client")}</h2>
        {audience ? (
          <p className="mt-2 text-sm text-muted">
            {t(
              "Use Authorization Code with PKCE for a user connection or Client Credentials for a provisioned automation identity.",
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {t("An operator must configure OAuth integration access.")}
          </p>
        )}
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
          {endpoints.map(([label, value]) =>
            value ? (
              <div className="contents" key={label}>
                <dt>{t(label)}</dt>
                <dd className="break-all font-mono">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-accent">
          <Link href="/api/docs">{t("API documentation")}</Link>
          <Link href="/api/openapi.json">OpenAPI JSON</Link>
        </div>
      </section>
      <section className={panel}>
        <h2 className="font-semibold">{t("Connection example")}</h2>
        <pre className="mt-3 overflow-auto rounded-md bg-subtle p-3 text-xs">
          {JSON.stringify(
            { url: `${origin}/mcp`, transport: "streamable-http" },
            null,
            2,
          )}
        </pre>
        <p className="mt-2 text-sm text-muted">
          {t("Use your client's OAuth setup to connect to this MCP endpoint.")}
        </p>
        <h3 className="mt-4 font-semibold">{t("Agent Skills")}</h3>
        <ul className="mt-2 grid gap-2 text-sm text-accent">
          {integrationSkills.map((skill) => (
            <li key={skill}>
              <a href={`/integration-skills/${skill}`} download>
                {skill}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          {t(
            "Save each SKILL.md in a folder with its skill name, then import that folder into your agent client.",
          )}
        </p>
      </section>
      <section className={panel}>
        <h2 className="font-semibold">{t("Current identity")}</h2>
        <p className="mt-2 text-sm">
          {user?.name ?? t("Researcher")} ·{" "}
          {t(
            user?.platformRole === "admin"
              ? "Platform administrator"
              : "Researcher",
          )}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-muted">{actor}</p>
        <h3 className="mt-4 font-semibold">{t("Program permissions")}</h3>
        <ul className="mt-2 divide-y divide-line text-sm">
          {permissions.map(({ id, name, view, submit, triage, manage }) => (
            <li className="py-2" key={id}>
              <Link href={`/programs/${id}`}>{name}</Link>
              <span className="ml-2 text-muted">
                {[
                  view && t("View"),
                  submit && t("Submit"),
                  triage && t("Triage"),
                  manage && t("Manage"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
        {permissions.length === 0 && (
          <p className="mt-2 text-sm text-muted">{t("No programs found.")}</p>
        )}
      </section>
      <section className={panel}>
        <h2 className="font-semibold">{t("Recent integration activity")}</h2>
        {activity.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {t("No integration activity yet.")}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {activity.map((event) => (
              <li className="break-words py-2" key={event.id}>
                <div>
                  {event.operation} · {event.outcome} ·{" "}
                  {dateTime(event.createdAt)}
                </div>
                <div className="text-xs text-muted">
                  {event.clientId} ·{" "}
                  {t(
                    event.actorType === "service"
                      ? "Automation identity"
                      : "Delegated user",
                  )}{" "}
                  · <span className="font-mono">{event.requestId}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
