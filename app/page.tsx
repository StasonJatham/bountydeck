import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Brand } from "../components/brand";
import { LocaleControl } from "../components/locale-control";
import { ThemeControl } from "../components/theme-control";
import { getI18n } from "../lib/i18n";

export default async function Home() {
  const { t } = await getI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col px-6 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-5">
        <Brand />
        <div className="flex flex-wrap gap-2">
          <LocaleControl />
          <ThemeControl />
        </div>
      </header>
      <section className="flex flex-1 flex-col justify-center py-20">
        <h1 className="max-w-3xl text-5xl leading-[1.02] font-semibold tracking-[-0.065em] text-balance sm:text-7xl">
          {t("Find vulnerabilities. Earn recognition.")}
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          {t(
            "Find eligible programs, report security vulnerabilities, and track your submissions.",
          )}
        </p>
        <Link
          className="mt-8 inline-flex w-fit items-center gap-2 rounded-md bg-action px-4 py-2.5 text-sm font-medium text-on-action hover:bg-action-hover"
          href="/sign-in"
        >
          {t("Sign in")} <ArrowRight size={16} aria-hidden />
        </Link>
      </section>
    </main>
  );
}
