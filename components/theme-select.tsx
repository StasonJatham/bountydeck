"use client";

import { useTransition, useSyncExternalStore } from "react";
import { type Theme } from "../lib/theme";

import { Switch } from "./ui/switch";

const darkPreference = "(prefers-color-scheme: dark)";
function subscribe(callback: () => void) {
  const query = matchMedia(darkPreference);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function ThemeSelect({
  theme,
  update,
  label,
}: {
  theme: Theme;
  update: (theme: "light" | "dark") => Promise<void>;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  const systemDark = useSyncExternalStore(
    subscribe,
    () => matchMedia(darkPreference).matches,
    () => false,
  );
  const dark = theme === "dark" || (theme === "system" && systemDark);
  return (
    <div className="flex items-center gap-1 text-sm text-muted">
      <span aria-hidden>{label}</span>
      <Switch
        aria-label={label}
        aria-checked={dark}
        disabled={pending}
        onClick={() => startTransition(() => update(dark ? "light" : "dark"))}
      />
    </div>
  );
}
