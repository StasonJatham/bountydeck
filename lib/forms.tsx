import type { ReactNode } from "react";

export const panel = "rounded-lg border border-neutral-200 bg-white p-5";
export const input =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

export function Text({
  label,
  name,
  max = 200,
  multiline = false,
  required = true,
}: {
  label: string;
  name: string;
  max?: number;
  multiline?: boolean;
  required?: boolean;
}) {
  const props = { name, maxLength: max, required, className: input };
  return (
    <Field label={label}>
      {multiline ? <textarea rows={4} {...props} /> : <input {...props} />}
    </Field>
  );
}
