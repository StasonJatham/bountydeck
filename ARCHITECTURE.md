# Architecture

Next.js serves pages, server actions, and authenticated downloads. Auth.js uses OIDC discovery, Authorization Code with PKCE, and PostgreSQL-backed sessions. Accounts key on issuer and subject. Invalidate a user's application sessions by deleting their session rows using the operator database role. The identity provider governs enrollment.

The request role has restricted PostgreSQL grants. Each sensitive operation opens a transaction, derives the actor from the server-side session, and sets a transaction-local actor context. PostgreSQL RLS checks the report, its program, and the actor's relationship before returning or changing data. Platform administrators have separate organizational grants for report oversight.

The schema uses immutable report events and score ledger records. A report lock serializes transitions. Validations and score events commit together. A unique award per report prevents duplicate scoring. Ranking queries aggregate eligible, visible ledger entries and use a stable cursor. Equal point totals share a rank. UTC quarter and year boundaries define seasons.

Evidence is private and downloaded after authorization. The API returns evidence and exports as downloads, with no shared caching. The export operation records an audit event. Keep database and evidence backups on the same retention schedule. The deployment guide describes the required backup boundary.

PostgreSQL triggers enqueue minimized notification records in the same transaction as report changes. A restricted worker takes row locks with `SKIP LOCKED`, delivers with bounded retries, and records attempts. Consumers should deduplicate by event ID. Webhook HTTPS origins and resolved addresses must match operator-approved destinations. The worker connects to a verified address with TLS hostname validation and rejects redirects.

## External integrations

REST and MCP accept OAuth access tokens and resolve the issuer and subject to an existing actor. Both transports use the same operation registry and actor-scoped transactions as the browser. The registry provides input validation and OpenAPI generation. Token credentials, report text, and evidence bytes stay out of integration audit entries.

## Achievement collection

The versioned catalog defines badge IDs, artwork, and award rules. Report and score changes reconcile calculated awards inside the same PostgreSQL transaction. Reopening a report for triage removes it from validated finding counts and clears its reproduction verification. Score corrections affect point thresholds through the ledger. Reconciliation records award and revocation events without granting points.

Manual recognition records the manager, report, and reason in the existing audit log. Competitive awards use immutable snapshots of completed UTC quarters and years. Finalization uses visible global leaderboard contributions and gives equal totals the same rank. Each badge can be earned once per applicable season.

The gallery, profile, and dashboard show the signed-in researcher's own collection. Shared profile reads require opt-in and return only featured badges that the viewer is authorized to see. Award provenance stays in the audit history.
