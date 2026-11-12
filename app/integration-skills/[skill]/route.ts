import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { integrationSkills } from "../../../lib/integration-skills";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return integrationSkills.map((skill) => ({ skill }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ skill: string }> },
) {
  const { skill } = await params;
  const name = integrationSkills.find((candidate) => candidate === skill);
  if (!name) return new Response(null, { status: 404 });

  const content = await readFile(
    join(process.cwd(), "skills", name, "SKILL.md"),
    "utf8",
  );
  return new Response(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="SKILL.md"',
    },
  });
}
