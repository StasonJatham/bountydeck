import { Client } from "pg";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const [
    issuer = "",
    subject = "",
    displayName = "",
    organizationId = "",
    administrator = "",
    ...extra
  ] = process.argv.slice(2);
  const name = displayName.trim();
  const url = URL.parse(issuer);
  if (
    !process.env.MIGRATION_DATABASE_URL ||
    extra.length > 0 ||
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    issuer.length > 512 ||
    !subject ||
    subject.length > 512 ||
    !name ||
    name.length > 120 ||
    !uuid.test(organizationId) ||
    !uuid.test(administrator)
  ) {
    throw new Error(
      "Set MIGRATION_DATABASE_URL and supply <issuer> <service-subject> <name> <organization-id> <platform-admin-id>",
    );
  }

  const provider = `oauth-service:${issuer}`;
  const client = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    const permission = await client.query(
      "SELECT 1 FROM users, org_units WHERE users.id = $1 AND users.platform_role = 'admin' AND org_units.id = $2",
      [administrator, organizationId],
    );
    if (!permission.rowCount)
      throw new Error("Organization or platform administrator unavailable");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [provider, subject],
    );
    const {
      rows: [existing],
    } = await client.query<{ user_id: string }>(
      "SELECT user_id FROM accounts WHERE provider = $1 AND provider_account_id = $2",
      [provider, subject],
    );
    if (existing) {
      const membership = await client.query(
        "SELECT 1 FROM org_memberships WHERE org_id = $1 AND user_id = $2",
        [organizationId, existing.user_id],
      );
      if (!membership.rowCount)
        throw new Error(
          "Identity already exists. Manage organization access through BountyDeck",
        );
      await client.query("COMMIT");
      console.log(existing.user_id);
      return;
    }
    const {
      rows: [user],
    } = await client.query<{ id: string }>(
      "INSERT INTO users (name) VALUES ($1) RETURNING id",
      [name],
    );
    await client.query(
      "INSERT INTO accounts (provider, provider_account_id, user_id, type) VALUES ($1, $2, $3, 'oauth-service')",
      [provider, subject, user.id],
    );
    await client.query(
      "INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'member')",
      [organizationId, user.id],
    );
    await client.query(
      "INSERT INTO audit_events (org_id, actor_id, kind, details) VALUES ($1, $2, 'integration.service_provisioned', jsonb_build_object('serviceActorId', $3::uuid))",
      [organizationId, administrator, user.id],
    );
    await client.query("COMMIT");
    console.log(user.id);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Provisioning failed");
  process.exitCode = 1;
});
