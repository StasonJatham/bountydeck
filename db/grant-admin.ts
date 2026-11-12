import { Client } from "pg";

async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  const [provider, subject, ...extra] = process.argv.slice(2);
  if (!connectionString || !provider || !subject || extra.length) {
    throw new Error(
      "Set MIGRATION_DATABASE_URL and run npm run grant-admin -- <provider-id> <OIDC-subject>",
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(
      `UPDATE users SET platform_role = 'admin' FROM accounts
        WHERE users.id = accounts.user_id AND accounts.provider = $1
          AND accounts.provider_account_id = $2 AND users.platform_role <> 'admin'
        RETURNING users.id`,
      [provider, subject],
    );
    if (!result.rowCount)
      throw new Error("Identity not found or already a platform administrator");
    await client.query(
      "INSERT INTO audit_events (actor_id, kind) VALUES ($1, 'platform_admin_granted_by_operator')",
      [result.rows[0].id],
    );
    await client.query("COMMIT");
    console.log("Granted platform administrator");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
