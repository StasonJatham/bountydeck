"use client";

import { useId, useRef, type ReactNode } from "react";
import { Button } from "./ui/button";

export function AchievementDialog({
  title,
  label,
  accessibleLabel,
  close,
  children,
}: {
  title: string;
  label: string;
  accessibleLabel: string;
  close: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  return (
    <>
      <Button
        variant="outline"
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label={accessibleLabel}
      >
        {label}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={heading}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-line bg-surface p-6 text-foreground shadow-lg backdrop:bg-black/50"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id={heading} className="text-xl font-semibold">
            {title}
          </h2>
          <Button
            variant="outline"
            type="button"
            onClick={() => dialog.current?.close()}
          >
            {close}
          </Button>
        </div>
        {children}
      </dialog>
    </>
  );
}
