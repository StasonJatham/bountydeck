import { LocaleControl } from "./locale-control";
import { ThemeControl } from "./theme-control";

export function SiteFooter() {
  return (
    <footer className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-line px-5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <LocaleControl />
      <ThemeControl />
    </footer>
  );
}
