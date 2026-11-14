"use client";

import { useRef, useState } from "react";
import Markdown from "react-markdown";
import { Switch } from "./ui/switch";

export function MarkdownEditor({
  name,
  initial,
  preview,
  list,
  label,
}: {
  name: string;
  initial: string;
  preview: string;
  list: string;
  label: string;
}) {
  const [value, setValue] = useState(initial);
  const [showPreview, setShowPreview] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="min-w-0">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          className="underline disabled:opacity-50"
          disabled={showPreview}
          onClick={() => {
            const area = field.current;
            if (!area) return;
            const start =
              area.value.lastIndexOf("\n", area.selectionStart - 1) + 1;
            setValue(
              area.value.slice(0, start) + "- " + area.value.slice(start),
            );
            area.focus();
          }}
        >
          {list}
        </button>
        <span>{preview}</span>
        <Switch
          aria-label={preview}
          aria-checked={showPreview}
          onClick={() => setShowPreview(!showPreview)}
        />
      </div>
      <textarea
        ref={field}
        id={name}
        name={name}
        hidden={showPreview}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={10000}
        rows={5}
        className="w-full rounded-md border border-control bg-surface p-2 font-mono text-sm"
      />
      {showPreview && (
        <div className="markdown max-h-72 overflow-auto wrap-anywhere rounded-md border border-line p-3">
          <Markdown skipHtml disallowedElements={["img"]}>
            {value}
          </Markdown>
        </div>
      )}
    </div>
  );
}
