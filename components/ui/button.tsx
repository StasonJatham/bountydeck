"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

const variants = {
  default: "bg-neutral-900 text-white hover:bg-neutral-800",
  outline:
    "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50",
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
