import { Button } from "../../../../components/ui/button";
import { joinProgram } from "../../../../lib/management";
import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withActor } from "../../../../db";
import {
  programMemberships,
  programs,
  programScopes,
  rewards,
} from "../../../../db/schema";
import { requireActor } from "../../../../lib/actor";
import { Field, input, panel, Text } from "../../../../lib/forms";
import { submitReport } from "../../../../lib/report-actions";
import { severities } from "../../../../lib/workflow";

export default async function Program({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        program: programs,
        eligible: sql<boolean>`app_can_submit(${programs.id})`,
        manages: sql<boolean>`app_manages_program(${programs.id})`,
      })
      .from(programs)
      .where(eq(programs.id, id));
    if (!row) notFound();
    const scope = await tx
      .select()
      .from(programScopes)
      .where(eq(programScopes.programId, id))
      .orderBy(programScopes.name);
    const offers = await tx
      .select()
      .from(rewards)
      .where(eq(rewards.programId, id));
    const [membership] = await tx
      .select({ userId: programMemberships.userId })
      .from(programMemberships)
      .where(
        and(
          eq(programMemberships.programId, id),
          eq(programMemberships.userId, actor),
          eq(programMemberships.role, "researcher"),
        ),
      );
    return { ...row, scope, offers, joined: Boolean(membership) };
  });
  const { program, eligible, manages, scope, offers, joined } = result;
  const error = (await searchParams).error;
  const assets = scope.filter((asset) => asset.inScope);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid content-start gap-4">
        {manages && (
          <Link
            className="w-fit text-sm font-medium"
            href={`/programs/${id}/manage`}
          >
            Manage program →
          </Link>
        )}
        <div>
          <p className="text-sm capitalize text-neutral-600">
            {program.status}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {program.name}
          </h1>
          <p className="mt-3 whitespace-pre-wrap">{program.description}</p>
        </div>
        {eligible && !joined && (
          <form action={joinProgram.bind(null, id)}>
            <Button>Join program</Button>
          </form>
        )}
        <section className={panel}>
          <h2 className="font-semibold">Points and rewards</h2>
          <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
            {severities.map((severity) => (
              <li className="capitalize" key={severity}>
                {severity} · {program.scoring[severity] ?? 0} points
              </li>
            ))}
          </ul>
          {offers.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {offers.map((reward) => (
                <li key={reward.id}>
                  <strong>{reward.name}</strong> · {reward.minimumPoints} points
                  <p>{reward.description}</p>
                </li>
              ))}
            </ul>
          )}
          <Link
            className="mt-4 inline-block text-sm underline"
            href={`/leaderboard?scope=program:${id}`}
          >
            Program leaderboard
          </Link>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">Scope</h2>
          <ul className="mt-3 space-y-3">
            {scope.map((asset) => (
              <li key={asset.id}>
                <strong>{asset.name}</strong>
                <span className="ml-2 text-sm text-neutral-600">
                  {asset.inScope ? "In scope" : "Out of scope"}
                </span>
                <p>{asset.description}</p>
              </li>
            ))}
          </ul>
          {!scope.length && <p className="mt-2 text-sm">No assets defined.</p>}
        </section>
        <section className={panel}>
          <h2 className="font-semibold">Testing rules</h2>
          <p className="mt-2 whitespace-pre-wrap">{program.rules}</p>
          <h2 className="mt-5 font-semibold">Disclosure policy</h2>
          <p className="mt-2 whitespace-pre-wrap">{program.disclosurePolicy}</p>
        </section>
      </div>
      {!eligible && (
        <p className="text-sm text-neutral-600">
          This program isn’t accepting submissions from your account.
        </p>
      )}
      {eligible && assets.length === 0 && (
        <p className="text-sm text-neutral-600">
          This program has no in-scope assets yet.
        </p>
      )}
      {eligible && assets.length > 0 && (
        <form
          action={submitReport.bind(null, id)}
          className={`${panel} grid content-start gap-4`}
        >
          <h2 className="text-xl font-semibold">Submit a report</h2>
          {error && (
            <p role="alert" className="text-sm text-red-800">
              {error === "rate-limit"
                ? "Submission limit reached. Try again later."
                : "Check the report fields and try again."}
            </p>
          )}
          <Text name="title" label="Title" />
          <Field label="Affected asset">
            <select className={input} name="assetId" required>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </Field>
          <Text name="cwe" label="Weakness (e.g. CWE-200)" max={9} />
          <Field label="Proposed severity">
            <select className={input} name="proposedSeverity">
              {severities.map((severity) => (
                <option key={severity}>{severity}</option>
              ))}
            </select>
          </Field>
          <Text name="description" label="Description" multiline max={12000} />
          <Text name="steps" label="Reproduction steps" multiline max={12000} />
          <Text
            name="proofOfConcept"
            label="Proof of concept"
            multiline
            max={12000}
          />
          <Text name="impact" label="Impact" multiline max={12000} />
          <Button>Submit report</Button>
        </form>
      )}
    </div>
  );
}
