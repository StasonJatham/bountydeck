"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

const variants = {
  default: "bg-action text-on-action hover:bg-action-hover",
  outline: "border border-control bg-surface text-foreground hover:bg-subtle",
};

export function Button({
  className = "",
  variant = "default",
  disabled,
  type = "submit",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  const { pending } = useFormStatus();
  return (
    <button
      data-slot="button"
      data-variant={variant}
      className={`inline-flex min-h-9 w-fit shrink-0 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`}
      disabled={disabled || (pending && type === "submit")}
      type={type}
      {...props}
    />
  );
}
