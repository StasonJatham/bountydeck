import { notFound } from "next/navigation";
import { z } from "zod";
import { SiteHeader } from "../../../components/site-header";
import { getBranding } from "../../../lib/branding";
import { preferenceSession } from "../../../lib/preferences";
import { readDisclosure } from "../../../lib/integrations/public-disclosures";

export default async function Disclosure({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const entry = await readDisclosure(id, (await preferenceSession())?.actorId);
  if (!entry) notFound();
  return (
    <>
      <SiteHeader brand={await getBranding()} />
      <main className="mx-auto w-full max-w-3xl space-y-4 p-6">
        <h1 className="wrap-anywhere text-3xl font-semibold">{entry.title}</h1>
        <p className="whitespace-pre-wrap wrap-anywhere">{entry.summary}</p>
      </main>
    </>
  );
}
