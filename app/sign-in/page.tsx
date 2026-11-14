import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "../../components/brand";
import { LocaleControl } from "../../components/locale-control";
import { ThemeControl } from "../../components/theme-control";
import { Button } from "../../components/ui/button";
import { auth, signIn } from "../../lib/auth";
import { getI18n } from "../../lib/i18n";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if ((await auth())?.actorId) redirect("/dashboard");
  const { t } = await getI18n();
  return (
    <main className="mx-auto grid min-h-dvh max-w-lg grid-rows-[1fr_auto_1fr] px-5">
      <section className="row-start-2 mx-auto grid w-full max-w-sm justify-items-center gap-4 py-4 text-center">
        <Link className="mb-2 inline-flex" href="/">
          <Brand />
        </Link>
        <h1 className="text-2xl font-semibold">{t("Sign in")}</h1>
        {(await searchParams).error && (
          <p role="alert" className="text-sm text-danger">
            {t("Sign-in failed. Please try again.")}
          </p>
        )}
        <form
          className="w-full"
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
          <Button className="min-h-11 w-full">
            {t("Sign in with Company account")}
          </Button>
        </form>
      </section>
      <footer className="row-start-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 self-end pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <LocaleControl />
        <ThemeControl compact />
      </footer>
    </main>
  );
}
