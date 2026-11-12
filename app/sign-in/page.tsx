import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "../../components/brand";
import { LocaleControl } from "../../components/locale-control";
import { ThemeControl } from "../../components/theme-control";
import { Button } from "../../components/ui/button";
import { auth, signIn } from "../../lib/auth";
import { panel } from "../../lib/forms";
import { getI18n } from "../../lib/i18n";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if ((await auth())?.actorId) redirect("/dashboard");
  const { t } = await getI18n();
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-5 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link className="flex items-center gap-2 font-semibold" href="/">
          <Brand />
        </Link>
        <div className="flex flex-wrap gap-2">
          <LocaleControl />
          <ThemeControl />
        </div>
      </header>
      <section className={`${panel} grid gap-4`}>
        <h1 className="text-2xl font-semibold">{t("Sign in")}</h1>
        {(await searchParams).error && (
          <p role="alert" className="text-sm text-danger">
            {t("Sign-in failed. Please try again.")}
          </p>
        )}
        <form
          action={async () => {
            "use server";
            const { locale } = await getI18n();
            await signIn(
              "oidc",
              { redirectTo: "/dashboard" },
              { ui_locales: locale },
            );
          }}
        >
          <Button>{t("Sign in with Company account")}</Button>
        </form>
      </section>
    </main>
  );
}
