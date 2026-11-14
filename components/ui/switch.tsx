import type { ComponentProps } from "react";

export function Switch({
  "aria-checked": checked,
  ...props
}: Omit<ComponentProps<"button">, "type" | "role" | "aria-checked"> & {
  "aria-checked": boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      className="group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        aria-hidden
        className="inline-flex h-5 w-9 items-center rounded-full border border-control bg-subtle p-0.5 group-aria-checked:border-action group-aria-checked:bg-action"
      >
        <span className="size-3.5 rounded-full bg-foreground group-aria-checked:translate-x-3.5 group-aria-checked:bg-on-action motion-safe:transition-transform" />
      </span>
    </button>
  );
}
