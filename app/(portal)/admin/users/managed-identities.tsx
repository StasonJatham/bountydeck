import Link from "next/link";
import { Button } from "../../../../components/ui/button";
import {
  createManagedIdentity,
  listManagedIdentities,
  manageIdentity,
} from "../../../../lib/admin-users";
import { Field, input, panel } from "../../../../lib/forms";
import { getI18n } from "../../../../lib/i18n";

export async function ManagedIdentities({ page }: { page: number }) {
  const [{ state, identities }, { t }] = await Promise.all([
    listManagedIdentities(page * 100),
    getI18n(),
  ]);
  if (state !== "ready")
    return (
      <p className="mt-4 text-sm text-muted">
        {t(
          state === "unconfigured"
            ? "Keycloak account management is not configured."
            : "Keycloak account management is currently unavailable.",
        )}
      </p>
    );
  return (
    <div className="mt-6 grid gap-4">
      <form action={createManagedIdentity} className={`${panel} grid gap-3`}>
        <h2 className="font-semibold">{t("Create Keycloak account")}</h2>
        <Field label={t("Username")}>
          <input
            className={input}
            name="username"
            required
            minLength={3}
            maxLength={80}
            autoComplete="off"
          />
        </Field>
        <ProfileFields t={t} />
        <PasswordField t={t} />
        <Button>{t("Create account")}</Button>
      </form>
      <section className={panel}>
        <h2 className="font-semibold">{t("Managed Keycloak accounts")}</h2>
        <ul className="mt-3 divide-y divide-line">
          {identities.map((user) => (
            <li key={user.id} className="py-2">
              <details>
                <summary className="cursor-pointer break-all">
                  {user.username} · {t(user.enabled ? "Enabled" : "Disabled")}
                </summary>
                <div className="mt-3 grid gap-3">
                  <form action={manageIdentity} className="grid gap-2">
                    <input type="hidden" name="id" value={user.id} />
                    <ProfileFields t={t} user={user} />
                    <Button name="operation" value="edit">
                      {t("Save profile")}
                    </Button>
                  </form>
                  <form action={manageIdentity} className="grid gap-2">
                    <input type="hidden" name="id" value={user.id} />
                    <PasswordField t={t} />
                    <Button variant="outline" name="operation" value="reset">
                      {t("Reset password")}
                    </Button>
                  </form>
                  <form
                    action={manageIdentity}
                    className="flex flex-wrap gap-2"
                  >
                    <input type="hidden" name="id" value={user.id} />
                    <Button
                      variant="outline"
                      name="operation"
                      value={user.enabled ? "disable" : "enable"}
                    >
                      {t(user.enabled ? "Disable account" : "Enable account")}
                    </Button>
                    <Button variant="outline" name="operation" value="logout">
                      {t("End Keycloak and application sessions")}
                    </Button>
                    <Button
                      variant="outline"
                      name="operation"
                      value="requirePassword"
                    >
                      {t("Require password change at next sign-in")}
                    </Button>
                  </form>
                  <form action={manageIdentity} className="grid gap-2">
                    <input type="hidden" name="id" value={user.id} />
                    <label className="flex gap-2">
                      <input
                        name="confirm"
                        type="checkbox"
                        value="yes"
                        required
                      />
                      {t(
                        "Delete the Keycloak account permanently and retain report history.",
                      )}
                    </label>
                    <Button variant="outline" name="operation" value="delete">
                      {t("Delete account")}
                    </Button>
                  </form>
                </div>
              </details>
            </li>
          ))}
        </ul>
        {!identities.length && <p>{t("No managed accounts on this page.")}</p>}
        <nav className="flex gap-4 text-accent">
          {page > 0 && (
            <Link href={`/admin/users?page=${page - 1}`}>
              {t("Previous page")}
            </Link>
          )}
          {identities.length > 0 && (
            <Link href={`/admin/users?page=${page + 1}`}>{t("Next page")}</Link>
          )}
        </nav>
      </section>
    </div>
  );
}

function ProfileFields({
  t,
  user,
}: {
  t: (text: string) => string;
  user?: { firstName?: string; lastName?: string; email?: string };
}) {
  return (
    <>
      <Field label={t("First name")}>
        <input
          className={input}
          name="firstName"
          defaultValue={user?.firstName}
          maxLength={120}
        />
      </Field>
      <Field label={t("Last name")}>
        <input
          className={input}
          name="lastName"
          defaultValue={user?.lastName}
          maxLength={120}
        />
      </Field>
      <Field label={t("Email")}>
        <input
          className={input}
          name="email"
          type="email"
          defaultValue={user?.email}
          maxLength={254}
          required
        />
      </Field>
    </>
  );
}

function PasswordField({ t }: { t: (text: string) => string }) {
  return (
    <Field label={t("Temporary password")}>
      <input
        className={input}
        name="password"
        type="password"
        minLength={12}
        maxLength={256}
        required
        autoComplete="new-password"
      />
    </Field>
  );
}
