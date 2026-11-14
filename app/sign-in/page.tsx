import { SiteHeader } from "../../components/site-header";
import { redirect } from "next/navigation";
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
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-lg flex-1 place-items-center px-5">
        <section className="mx-auto grid w-full max-w-sm justify-items-center gap-4 py-4 text-center">
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
      </main>
    </>
  );
}
