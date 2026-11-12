import { integrationOrigin } from "../../../../lib/integrations/http";

export function GET() {
  try {
    const origin = integrationOrigin().origin;
    const resource = `${origin}/mcp`;
    const issuer = process.env.OIDC_ISSUER;
    if (
      !issuer ||
      !URL.canParse(issuer) ||
      process.env.INTEGRATION_AUDIENCE !== resource
    )
      return new Response(null, { status: 404 });
    return Response.json(
      {
        resource,
        resource_name: "BountyDeck",
        authorization_servers: [issuer],
        scopes_supported: [process.env.INTEGRATION_SCOPE || "bountydeck.api"],
        bearer_methods_supported: ["header"],
        resource_documentation: `${origin}/api/docs`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return new Response(null, { status: 404 });
  }
}
