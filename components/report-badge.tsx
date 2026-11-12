import type { ReactNode } from "react";

const severityTone: Record<string, string> = {
  critical: "bg-danger/15 text-danger",
  high: "bg-danger/10 text-danger",
  medium: "bg-warning/10 text-warning",
  low: "bg-accent/10 text-accent",
};

const statusTone: Record<string, string> = {
  submitted: "bg-accent/10 text-accent",
  triage: "bg-accent/10 text-accent",
  needs_information: "bg-warning/10 text-warning",
  validated: "bg-success/10 text-success",
  resolved: "bg-success/10 text-success",
  published: "bg-success/10 text-success",
  paused: "bg-warning/10 text-warning",
};

export function ReportBadge({
  children,
  severity,
  status,
}: {
  children: ReactNode;
  severity?: string;
  status?: string;
}) {
  const tone = severity ? severityTone[severity] : status && statusTone[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tone || "bg-subtle text-muted"}`}
    >
      {children}
    </span>
  );
}
