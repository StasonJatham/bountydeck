"use client";

import { useActionState } from "react";
import { Button } from "../../../components/ui/button";
import { createKey } from "./key-actions";

export function KeyForm({
  name,
  create,
  copy,
}: {
  name: string;
  create: string;
  copy: string;
}) {
  const [key, action] = useActionState(createKey, "");
  return (
    <>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          required
          maxLength={80}
          aria-label={name}
          placeholder={name}
          className="rounded-md border border-control bg-surface p-2"
        />
        <Button>{create}</Button>
      </form>
      {key && (
        <p role="status" className="text-sm">
          {copy} <code className="break-all select-all">{key}</code>
        </p>
      )}
    </>
  );
}
