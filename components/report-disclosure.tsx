import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withActor } from "../db";
import { requireActor } from "../lib/actor";
import { getI18n } from "../lib/i18n";
import { panel, input, Field, Text } from "../lib/forms";
import { Button } from "./ui/button";
import { DisclosurePreview } from "./disclosure-preview";

async function change(id: string, operation: string, data: FormData) {
  "use server";
  const actor = await requireActor();
  const values = z
    .object({
      audience: z.enum(["members", "public"]).default("members"),
      format: z.enum(["limited", "detailed"]).default("limited"),
      title: z.string().trim().min(1).max(160).optional(),
      summary: z.string().trim().min(1).max(12000).optional(),
    })
    .safeParse(Object.fromEntries(data));
  const path = `/reports/${id}`;
  if (!values.success) redirect(path + "?disclosureError=1#disclosure");
  const { audience, format, title, summary } = values.data;
  if (operation === "approve" && (!title || !summary || !data.has("confirmed")))
    redirect(path + "?disclosureError=1#disclosure");
  const {
    rows: [result],
  } = await withActor(actor, (tx) =>
    tx.execute<{ ok: boolean }>(sql`
    select change_disclosure(${id}, ${operation}, ${audience}, ${format}, ${title ?? null}, ${summary ?? null}) as ok
  `),
  );
  if (!result.ok) redirect(path + "?disclosureError=1#disclosure");
  revalidatePath(path);
  redirect(path + "#disclosure");
}

export async function ReportDisclosure({
  id,
  manager,
  closed,
  error,
}: {
  id: string;
  manager: boolean;
  closed: boolean;
  error: boolean;
}) {
  const actor = await requireActor();
  const { t } = await getI18n();
  const {
    rows: [row],
  } = await withActor(actor, (tx) =>
    tx.execute<{
      state: string | null;
      audience: string | null;
      format: string | null;
      mode: string;
      directory: boolean;
      published: boolean;
    }>(sql`
    select d.state,d.audience,d.format,p.disclosure_mode as mode,p.directory_public as directory,p.status='published' as published
    from reports r join programs p on p.id=r.program_id
    left join disclosure_requests d on d.report_id=r.id where r.id=${id}
  `),
  );
  if (!row) return null;
  const requestable = closed && row.mode !== "disabled";
  const allowPublic = row.mode === "public" && row.directory && row.published;
  return (
    <section id="disclosure" className={`${panel} mt-6 space-y-3`}>
      <h2 className="font-semibold">{t("Report disclosure")}</h2>
      {row.state && <p>{t(row.state)}</p>}
      {error && (
        <p role="alert">{t("The disclosure change was not accepted.")}</p>
      )}
      {!row.state && !requestable && (
        <p>{t("Disclosure is unavailable for this report.")}</p>
      )}
      {requestable &&
        (!row.state || ["denied", "withdrawn"].includes(row.state)) && (
          <form
            action={change.bind(null, id, "request")}
            className="grid gap-3"
          >
            <Field label={t("Audience")}>
              <select name="audience" className={input}>
                <option value="members">
                  {t("Program participants only")}
                </option>
                {allowPublic && <option value="public">{t("Public")}</option>}
              </select>
            </Field>
            <Field label={t("Disclosure format")}>
              <select name="format" className={input}>
                <option value="limited">{t("Limited")}</option>
                <option value="detailed">{t("Detailed")}</option>
              </select>
            </Field>
            <Button>{t("Request disclosure")}</Button>
          </form>
        )}
      {row.state === "pending" && manager && (
        <>
          {requestable && (
            <form
              action={change.bind(null, id, "approve")}
              className="grid gap-3"
            >
              <Field label={t("Audience")}>
                <select
                  name="audience"
                  className={input}
                  defaultValue={
                    allowPublic ? (row.audience ?? "members") : "members"
                  }
                >
                  <option value="members">
                    {t("Program participants only")}
                  </option>
                  {allowPublic && row.audience === "public" && (
                    <option value="public">{t("Public")}</option>
                  )}
                </select>
              </Field>
              <Field label={t("Disclosure format")}>
                <select
                  name="format"
                  className={input}
                  defaultValue={row.format ?? "limited"}
                >
                  <option value="limited">{t("Limited")}</option>
                  {row.format === "detailed" && (
                    <option value="detailed">{t("Detailed")}</option>
                  )}
                </select>
              </Field>
              <Text name="title" label={t("Publication title")} max={160} />
              <DisclosurePreview label={t("Redacted publication text")} />
              <label className="flex gap-2">
                <input type="checkbox" name="confirmed" required />
                {t(
                  "I reviewed the publication and removed confidential details.",
                )}
              </label>
              <Button>{t("Approve disclosure")}</Button>
            </form>
          )}
          <form action={change.bind(null, id, "deny")}>
            <Button variant="outline">{t("Deny disclosure")}</Button>
          </form>
        </>
      )}
      {row.state === "approved" && (
        <a href={`/disclosures/${id}`} className="text-accent underline">
          {t("View disclosure")}
        </a>
      )}
      {row.state === "approved" && manager && (
        <form action={change.bind(null, id, "withdraw")}>
          <Button variant="outline">{t("Withdraw disclosure")}</Button>
        </form>
      )}
    </section>
  );
}
