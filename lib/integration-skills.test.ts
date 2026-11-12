import { expect, test } from "vitest";
import {
  GET,
  generateStaticParams,
} from "../app/integration-skills/[skill]/route";
import { integrationSkills } from "./integration-skills";

const request = new Request("http://localhost/integration-skills");

test.each(integrationSkills)(
  "%s downloads with valid skill metadata",
  async (skill) => {
    const response = await GET(request, { params: Promise.resolve({ skill }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="SKILL.md"',
    );
    const content = await response.text();
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(content)?.[1];
    expect(frontmatter).toContain(`name: ${skill}\n`);
    expect(frontmatter).toMatch(/(?:^|\n)description: [^\n]+/);
    expect(generateStaticParams()).toContainEqual({ skill });
  },
);

test("skill downloads reject unlisted names", async () => {
  const response = await GET(request, {
    params: Promise.resolve({ skill: "unknown" }),
  });
  expect(response.status).toBe(404);
});
