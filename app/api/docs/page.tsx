import { SiteHeader } from "../../../components/site-header";
import Link from "next/link";
import { requireActor } from "../../../lib/actor";
import { openApi } from "../../../lib/integrations/openapi";
import { RequestRunner } from "./request-runner";

export default async function ApiDocs() {
  await requireActor();
  const spec = openApi();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl space-y-5 px-5 py-8">
        <Link href="/integrations" className="text-accent">
          ← Integrations
        </Link>
        <h1 className="text-3xl font-semibold">BountyDeck API</h1>
        <p>{spec.info.description}</p>
        <p className="text-sm">
          The request runner uses your token for this request. Use a disposable
          case when trying operations that write data.
        </p>
        <Link href="/api/openapi.json" className="text-accent underline">
          Download OpenAPI 3.1 JSON
        </Link>
        <RequestRunner
          operations={Object.entries(spec.paths).flatMap(([path, methods]) =>
            Object.keys(methods).map(
              (method) => `${method.toUpperCase()} ${path}`,
            ),
          )}
        />
        <details className="rounded-lg border border-line bg-surface p-4">
          <summary>OpenAPI reference</summary>
          <pre className="mt-4 overflow-auto text-xs">
            {JSON.stringify(spec, null, 2)}
          </pre>
        </details>
      </main>
    </>
  );
}
