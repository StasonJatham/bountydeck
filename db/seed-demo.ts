import { Client } from "pg";

const fixtureId = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

async function main() {
  const connectionString = process.env.DEMO_DATABASE_URL;
  const issuer = process.env.OIDC_ISSUER;
  if (
    !connectionString ||
    !issuer ||
    process.env.BOUNTYDECK_DEMO_FIXTURES !== "1"
  ) {
    throw new Error(
      "Set DEMO_DATABASE_URL, OIDC_ISSUER and BOUNTYDECK_DEMO_FIXTURES=1 for a disposable demo database",
    );
  }

  const provider = `oidc:${issuer}`;
  const people = [
    {
      username: "local-platform-admin",
      subject: process.env.DEMO_ADMIN_SUBJECT ?? fixtureId(105),
    },
    { username: "local-researcher", subject: fixtureId(101) },
    { username: "local-triager", subject: fixtureId(102) },
    { username: "local-manager", subject: fixtureId(103) },
    { username: "local-outsider", subject: fixtureId(104) },
  ];
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE org_units IN SHARE ROW EXCLUSIVE MODE");
    const { rowCount } = await client.query("SELECT FROM org_units LIMIT 1");
    if (rowCount)
      throw new Error("Demo data requires an empty organization directory");

    const actors: string[] = [];
    for (const person of people) {
      const existing = await client.query<{ user_id: string }>(
        "SELECT user_id FROM accounts WHERE provider = $1 AND provider_account_id = $2",
        [provider, person.subject],
      );
      if (existing.rows.length) {
        actors.push(existing.rows[0].user_id);
        continue;
      }

      const email = `${person.username}@example.invalid`;
      const {
        rows: [{ id }],
      } = await client.query<{ id: string }>(
        "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
        [person.username, email],
      );
      await client.query(
        "INSERT INTO accounts (user_id,type,provider,provider_account_id) VALUES ($1,'oidc',$2,$3)",
        [id, provider, person.subject],
      );
      actors.push(id);
    }

    const [admin, researcher, triager, manager, outsider] = actors;
    await client.query(
      "UPDATE users SET platform_role = 'admin' WHERE id = $1",
      [admin],
    );
    await client.query(
      "UPDATE users SET leaderboard_visible = true, pseudonym = 'Quartz' WHERE id = $1",
      [researcher],
    );

    const primary = fixtureId(1);
    const secondary = fixtureId(2);
    const third = fixtureId(3);
    await client.query(
      "INSERT INTO org_units (id, name, slug) VALUES ($1,'Application Security','applications'),($2,'Infrastructure','infrastructure'),($3,'Product Security','product')",
      [primary, secondary, third],
    );
    await client.query(
      "INSERT INTO org_memberships VALUES ($1,$2,'admin'),($1,$3,'member'),($4,$5,'member'),($4,$6,'admin'),($7,$6,'admin')",
      [primary, manager, researcher, secondary, outsider, admin, third],
    );

    const web = fixtureId(11);
    const infra = fixtureId(12);
    const product = fixtureId(13);
    const draft = fixtureId(14);
    await client.query(
      `INSERT INTO programs (id, org_id, name, slug, description, rules, disclosure_policy, status, eligibility) VALUES
      ($1,$2,'Web Applications','web','Internal demo web program','Use only the isolated demo asset.','Internal only.','published','all'),
      ($3,$4,'Infrastructure','infra','Internal infrastructure program','Use only the isolated demo asset.','Internal only.','published','organization'),
      ($5,$6,'Product Services','services','Invited researchers only','Use only the isolated demo asset.','Internal only.','published','invitation'),
      ($7,$2,'Mobile Applications','mobile','Upcoming demo program','','Internal only.','draft','organization')`,
      [web, primary, infra, secondary, product, third, draft],
    );
    await client.query(
      "INSERT INTO program_memberships VALUES ($1,$2,'manager'),($1,$3,'triager'),($1,$4,'researcher')",
      [web, manager, triager, researcher],
    );

    const sandbox = fixtureId(21);
    await client.query(
      `INSERT INTO program_scopes (id, program_id, name, description, in_scope) VALUES
      ($1,$2,'Demo application','Synthetic records in a fixture.',true),
      ($3,$2,'Production data','Excluded.',false),
      ($4,$5,'Demo infrastructure','Isolated fixture environment.',true),
      ($6,$7,'Demo product','Isolated fixture environment.',true)`,
      [
        sandbox,
        web,
        fixtureId(22),
        fixtureId(23),
        infra,
        fixtureId(24),
        product,
      ],
    );

    await client.query("SET LOCAL ROLE bossob_app");
    await client.query("SELECT set_config('app.actor_id', $1, true)", [
      researcher,
    ]);
    const reports = [
      { id: fixtureId(31), title: "Incorrect role in a sample report export" },
      {
        id: fixtureId(32),
        title: "Demo profile visibility preference ignored",
      },
      { id: fixtureId(33), title: "Inconsistent access state in the sandbox" },
    ];
    for (const report of reports) {
      await client.query(
        `INSERT INTO reports (id, program_id, reporter_id, asset_id, title, description, cwe, steps, impact, proposed_severity)
        VALUES ($1,$2,$3,$4,$5,'Synthetic report for demonstration.','CWE-200','Fixture only.','Demonstration only.','low')`,
        [report.id, web, researcher, sandbox, report.title],
      );
      await client.query(
        "INSERT INTO report_events (report_id, actor_id, kind) VALUES ($1,$2,'submitted')",
        [report.id, researcher],
      );
    }

    await client.query("SELECT set_config('app.actor_id', $1, true)", [
      triager,
    ]);
    for (const { id } of reports.slice(0, 2)) {
      await client.query(
        "UPDATE reports SET status='validated', severity='low', assignee_id=$2 WHERE id=$1",
        [id, triager],
      );
      await client.query(
        "INSERT INTO score_events (report_id, program_id, user_id, actor_id, kind, points, reason) VALUES ($1,$2,$3,$4,'award',50,'Fixture validation')",
        [id, web, researcher, triager],
      );
      await client.query(
        "INSERT INTO report_events (report_id, actor_id, kind) VALUES ($1,$2,'report.validated')",
        [id, triager],
      );
    }
    await client.query("UPDATE reports SET status='resolved' WHERE id=$1", [
      reports[1].id,
    ]);
    await client.query(
      "INSERT INTO report_events (report_id, actor_id, kind) VALUES ($1,$2,'report.resolved')",
      [reports[1].id, triager],
    );
    await client.query(
      "UPDATE reports SET status='needs_information', assignee_id=$2 WHERE id=$1",
      [reports[2].id, triager],
    );
    await client.query(
      "INSERT INTO report_comments (report_id, author_id, body) VALUES ($1,$2,'Could you clarify the expected sandbox behavior?')",
      [reports[2].id, triager],
    );

    await client.query("RESET ROLE");
    await client.query(
      `INSERT INTO seasons (name, starts_at, ends_at) VALUES
      ('Current quarter', date_trunc('quarter', now(), 'UTC'), date_trunc('quarter', now(), 'UTC') + interval '3 months'),
      ('Current year', date_trunc('year', now(), 'UTC'), date_trunc('year', now(), 'UTC') + interval '1 year')
      ON CONFLICT DO NOTHING`,
    );
    await client.query(
      "INSERT INTO rewards (program_id, name, description, minimum_points) VALUES ($1,'Contributor badge','Internal recognition for validated reports.',100)",
      [web],
    );
    await client.query(
      "INSERT INTO notification_channels (program_id, kind, destination, enabled, subscribed_events) VALUES ($1,'smtp','notifications@example.invalid',false,ARRAY['report.submitted','report.validated'])",
      [web],
    );
    await client.query("COMMIT");
    console.log(
      "Seeded three demo organizations, four programs, and three reports",
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
