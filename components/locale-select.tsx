"use client";

import type { Locale } from "../lib/i18n";

export function LocaleSelect({
  locale,
  label,
  update,
}: {
  locale: Locale;
  label: string;
  update: (data: FormData) => Promise<void>;
}) {
  return (
    <form action={update}>
      <select
        key={locale}
        name="locale"
        aria-label={label}
        defaultValue={locale}
        className="rounded-md border border-control bg-surface px-2 py-1.5 text-sm"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="de" lang="de">
          Deutsch
        </option>
      </select>
    </form>
  );
}
