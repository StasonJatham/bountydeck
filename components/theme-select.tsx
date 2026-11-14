"use client";

import { useState, useSyncExternalStore } from "react";
import { themeCookie, type Theme } from "../lib/theme";

import { Switch } from "./ui/switch";

const darkPreference = "(prefers-color-scheme: dark)";
function subscribe(callback: () => void) {
  const query = matchMedia(darkPreference);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function ThemeSelect({
  initialTheme,
  label,
}: {
  initialTheme: Theme;
  label: string;
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

  return (
    <div className="flex items-center gap-1 text-sm text-muted">
      <span aria-hidden>{label}</span>
      <Switch
        aria-label={label}
        aria-checked={dark}
        onClick={() => updateTheme(dark ? "light" : "dark")}
      />
    </div>
  );
}
