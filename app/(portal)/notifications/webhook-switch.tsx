"use client";

import { useState } from "react";
import { Switch } from "../../../components/ui/switch";

export function WebhookSwitch({
  name,
  value,
  label,
  initial,
}: {
  name: string;
  value: string;
  label: string;
  initial: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <Switch
        aria-label={label}
        aria-checked={checked}
        onClick={() => setChecked(!checked)}
      />
      {checked && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
