import { sql } from "drizzle-orm";
import { withActor } from "../db";
import { deleteRecord } from "../lib/admin-deletion";
import { requireActor } from "../lib/actor";
import { panel } from "../lib/forms";
import { getI18n } from "../lib/i18n";
import { Button } from "./ui/button";

export async function AdminDeleteRecord({
  kind,
  id,
  blocked,
}: {
  kind: "program" | "report";
  id: string;
  blocked: boolean;
}) {
  const actor = await requireActor();
  const {
    rows: [access],
  } = await withActor(actor, (tx) =>
    tx.execute<{ admin: boolean }>(sql`select app_platform_admin() as admin`),
  );
  if (!access.admin) return null;
  const { t } = await getI18n();
  return (
    <form
      className={`${panel} mt-6 grid gap-3`}
      action={deleteRecord.bind(null, kind, id)}
    >
      <h2 className="font-semibold text-danger">
        {t(
          kind === "report"
            ? "Permanently delete report"
            : "Permanently delete program",
        )}
      </h2>
      {blocked && (
        <p role="alert">
          {t(
            "Deletion is blocked because this record has retained dependencies.",
          )}
        </p>
      )}
      <label className="flex gap-2 text-sm">
        <input type="checkbox" required name="confirm" value="yes" />
        {t("I understand this action cannot be undone.")}
      </label>
      <Button variant="outline">{t("Delete permanently")}</Button>
    </form>
  );
}
