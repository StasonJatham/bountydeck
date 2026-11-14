import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withActor } from "../../../../db";
import { requireActor } from "../../../../lib/actor";
import { getI18n } from "../../../../lib/i18n";
import { Field, Text, input } from "../../../../lib/forms";
import { Button } from "../../../../components/ui/button";

async function asAdmin<T>(
  run: (tx: import("../../../../db").Tx) => Promise<T>,
) {
  return withActor(await requireActor(), async (tx) => {
    const {
      rows: [row],
    } = await tx.execute<{ allowed: boolean }>(
      sql`select app_platform_admin() as allowed`,
    );
    if (!row.allowed) notFound();
    return run(tx);
  });
}

export default async function Disclosures() {
  const { t } = await getI18n();
  const { rows } = await asAdmin((tx) =>
    tx.execute<{ id: string; title: string }>(sql`
    select id, title from public_disclosures order by title
  `),
  );
  return (
    <section className="grid max-w-2xl gap-4">
      <h1 className="text-3xl font-semibold">{t("Public disclosures")}</h1>
      <p>
        {t(
          "Publish a reviewed summary. Private report text, identities and evidence stay private.",
        )}
      </p>
      <form
        className="grid gap-3"
        action={async (data) => {
          "use server";
          const parsed = z
            .object({
              id: z.uuid(),
              kind: z.enum(["program", "report"]),
              title: z.string().trim().min(1).max(160),
              summary: z.string().trim().min(1).max(12000),
            })
            .safeParse(Object.fromEntries(data));
          if (!parsed.success) return;
          const { id, kind, title, summary } = parsed.data;
          await asAdmin((tx) =>
            tx.execute(sql`
          insert into public_disclosures (id, kind, title, summary)
          select ${id}, ${kind}, ${title}, ${summary}
          where (${kind} = 'program' and exists(select 1 from programs where id = ${id}))
             or (${kind} = 'report' and exists(select 1 from reports where id = ${id}))
          on conflict (id) do update set title = excluded.title, summary = excluded.summary
        `),
          );
          revalidatePath("/admin/disclosures");
        }}
      >
        <Field label={t("Type")}>
          <select name="kind" className={input}>
            <option value="program">{t("Program")}</option>
            <option value="report">{t("Report")}</option>
          </select>
        </Field>
        <Text name="id" label={t("Program or report ID")} max={36} />
        <Text name="title" label={t("Title")} max={160} />
        <Text
          name="summary"
          label={t("Public summary")}
          multiline
          max={12000}
        />
        <Button>{t("Publish summary")}</Button>
      </form>
      {rows.map((row) => (
        <form
          className="flex items-center justify-between gap-3"
          key={row.id}
          action={async () => {
            "use server";
            await asAdmin((tx) =>
              tx.execute(
                sql`delete from public_disclosures where id = ${row.id}`,
              ),
            );
            revalidatePath("/admin/disclosures");
          }}
        >
          <span>{row.title}</span>
          <Button variant="outline">{t("Unpublish")}</Button>
        </form>
      ))}
    </section>
  );
}
