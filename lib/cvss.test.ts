import { expect, test } from "vitest";
import { cvssScore } from "./cvss";

test("calculates a CVSS 4 base score and rejects malformed vectors", () => {
  expect(
    cvssScore(
      "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H",
    ),
  ).toBe(10);
  expect(cvssScore("CVSS:4.0/AV:N")).toBeNull();
});
