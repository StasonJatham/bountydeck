"use client";

import { useState, useSyncExternalStore } from "react";
import { parseTheme, themeCookie, themes, type Theme } from "../lib/theme";

import { Switch } from "./ui/switch";

const darkPreference = "(prefers-color-scheme: dark)";
function subscribe(callback: () => void) {
  const query = matchMedia(darkPreference);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function ThemeSelect({
  initialTheme,
  labels,
  compact = false,
}: {
  initialTheme: Theme;
  compact?: boolean;
  labels: Record<Theme | "label", string>;
}) {
  const [theme, setTheme] = useState(initialTheme);

  const systemDark = useSyncExternalStore(
    subscribe,
    () => matchMedia(darkPreference).matches,
    () => false,
  );
  const dark = theme === "dark" || (theme === "system" && systemDark);
  function updateTheme(next: Theme) {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${themeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1 text-sm text-muted">
        <span aria-hidden>{labels.dark}</span>
        <Switch
          aria-label={labels.dark}
          aria-checked={dark}
          onClick={() => updateTheme(dark ? "light" : "dark")}
        />
      </div>
    );
  }

  return (
    <select
      aria-label={labels.label}
      className="rounded-md border border-control bg-surface px-2 py-1.5 text-sm"
      value={theme}
      onChange={(event) => updateTheme(parseTheme(event.target.value))}
    >
      {themes.map((value) => (
        <option key={value} value={value}>
          {labels[value]}
        </option>
      ))}
    </select>
  );
}
