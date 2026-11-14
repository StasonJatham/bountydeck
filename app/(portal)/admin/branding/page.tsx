import { sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withActor } from "../../../../db";
import { requireActor } from "../../../../lib/actor";
import { encodeAvatar } from "../../../../lib/avatar";
import { getBranding } from "../../../../lib/branding";
import { getI18n } from "../../../../lib/i18n";
import { Field, input, panel } from "../../../../lib/forms";
import { Button } from "../../../../components/ui/button";
import { Brand } from "../../../../components/brand";

async function admin() {
  const actor = await requireActor();
  const {
    rows: [row],
  } = await withActor(actor, (tx) =>
    tx.execute<{ allowed: boolean }>(
      sql`select app_platform_admin() as allowed`,
    ),
  );
  if (!row.allowed) notFound();
  return actor;
}

async function save(data: FormData) {
  "use server";
  const actor = await admin();
  const result = z
    .object({
      name: z.string().trim().min(1).max(70),
      accent: z.string().regex(/^(?:#[0-9a-f]{6})?$/i),
    })
    .safeParse(Object.fromEntries(data));
  const file = data.get("logo");
  const upload = file instanceof File && file.size > 0;
  const logo = upload ? await encodeAvatar(file) : null;
  if (!result.success || (upload && !logo)) redirect("/admin/branding?error=1");
  const { name, accent } = result.data;
  await withActor(actor, (tx) =>
    tx.execute(sql`
    update branding set name = ${name}, accent = ${accent.toLowerCase() || null},
      logo = case when ${data.has("resetLogo") && !upload} then null else coalesce(${logo}::bytea, logo) end
  `),
  );
  revalidatePath("/", "layout");
  redirect("/admin/branding?saved=1");
}

export default async function Branding({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await admin();
  const { t } = await getI18n();
  const brand = await getBranding();
  const query = await searchParams;
  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-3xl font-semibold">{t("Branding")}</h1>
      <Brand brand={brand} />
      {query.saved && <p role="status">{t("Branding saved.")}</p>}
      {query.error && (
        <p role="alert">{t("Check the name, hex color and logo file.")}</p>
      )}
      <form action={save} className={`${panel} grid gap-4`}>
        <Field label={t("Company name")}>
          <input
            className={input}
            name="name"
            required
            maxLength={70}
            defaultValue={brand.name}
          />
        </Field>
        <Field label={t("Company logo")}>
          <input
            className="w-full min-w-0"
            name="logo"
            type="file"
            accept=".png,.jpg,.jpeg,.gif"
          />
        </Field>
        {brand.logo.startsWith("/api/") && (
          <label className="flex gap-2">
            <input type="checkbox" name="resetLogo" />
            {t("Use default logo")}
          </label>
        )}
        <Field label={t("Accent color")}>
          <input
            className={input}
            name="accent"
            pattern="#[0-9a-fA-F]{6}"
            placeholder="#5265e8"
            defaultValue={brand.accent ?? ""}
          />
        </Field>
        <Button>{t("Save settings")}</Button>
      </form>
    </section>
  );
}
