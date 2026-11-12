"use client";

import { useState } from "react";
import { parseTheme, themeCookie, themes, type Theme } from "../lib/theme";

export function ThemeSelect({
  initialTheme,
  labels,
}: {
  initialTheme: Theme;
  labels: Record<Theme | "label", string>;
}) {
  const [theme, setTheme] = useState(initialTheme);

  return (
    <select
      aria-label={labels.label}
      className="rounded-md border border-control bg-surface px-2 py-1.5 text-sm"
      value={theme}
      onChange={(event) => {
        const next = parseTheme(event.target.value);
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${themeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
        document.documentElement.dataset.theme = next;
        setTheme(next);
      }}
    >
      {themes.map((value) => (
        <option key={value} value={value}>
          {labels[value]}
        </option>
      ))}
    </select>
  );
}
