import { Button } from "../../../../components/ui/button";
import {
  listAdminUsers,
  revokeUserSessions,
} from "../../../../lib/admin-users";
import { requireActor } from "../../../../lib/actor";
import { getI18n } from "../../../../lib/i18n";

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ revoked?: string }>;
}) {
  const [users, actor, { t }, query] = await Promise.all([
    listAdminUsers(),
    requireActor(),
    getI18n(),
    searchParams,
  ]);
  return (
    <section>
      <h1 className="text-3xl font-semibold">{t("User management")}</h1>
      {query.revoked === "1" && (
        <p role="status">{t("Application sessions revoked.")}</p>
      )}
      <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-surface">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div>
              <p className="font-medium">
                {user.name ?? user.email ?? user.id}
              </p>
              <p className="text-sm text-muted">
                {user.email} ·{" "}
                {t(user.role === "admin" ? "Administrator" : "Researcher")}
              </p>
            </div>
            {user.id !== actor && (
              <form action={revokeUserSessions}>
                <input type="hidden" name="userId" value={user.id} />
                <Button variant="outline">
                  {t("Revoke application sessions")}
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
