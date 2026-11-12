import { expect, test } from "vitest";
import { canTransition } from "./workflow";

test("findings require review and retesting, and can be reopened", () => {
  expect(canTransition("submitted", "validated")).toBe(false);
  expect(canTransition("triage", "validated")).toBe(true);
  expect(canTransition("remediation", "resolved")).toBe(false);
  expect(canTransition("retesting", "resolved")).toBe(true);
  expect(canTransition("resolved", "triage")).toBe(true);
});
