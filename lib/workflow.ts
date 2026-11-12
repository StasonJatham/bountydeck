export const severities = ["low", "medium", "high", "critical"] as const;

export const transitions = {
  submitted: ["triage", "needs_information", "duplicate", "out_of_scope"],
  triage: [
    "validated",
    "needs_information",
    "duplicate",
    "informative",
    "out_of_scope",
    "not_applicable",
  ],
  needs_information: ["triage"],
  validated: ["remediation", "triage"],
  remediation: ["retesting", "triage"],
  retesting: ["resolved", "remediation"],
  resolved: ["triage"],
  duplicate: ["triage"],
  informative: ["triage"],
  out_of_scope: ["triage"],
  not_applicable: ["triage"],
} as const;

export type Status = keyof typeof transitions;

export function canTransition(from: Status, to: string) {
  return (transitions[from] as readonly string[]).includes(to);
}
