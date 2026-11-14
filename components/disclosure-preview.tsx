"use client";

import { useState } from "react";

export function DisclosurePreview({ label }: { label: string }) {
  const [summary, setSummary] = useState("");
  return (
    <>
      <textarea
        name="summary"
        aria-label={label}
        required
        maxLength={12000}
        rows={5}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        className="w-full rounded border border-control p-2"
      />
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap wrap-anywhere text-sm">
        {summary}
      </pre>
    </>
  );
}
