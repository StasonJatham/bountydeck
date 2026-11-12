# Backlog

| ID     | Priority | Dependencies            | Objective and verification                                                                           | State       | Blockers |
| ------ | -------- | ----------------------- | ---------------------------------------------------------------------------------------------------- | ----------- | -------- |
| FND    | P0       | None                    | Pin stack, initialize migrations and app. Build and start with real PostgreSQL.                      | IN_PROGRESS |          |
| IAM    | P0       | FND                     | Integrate OIDC, roles and organizations. Verify sessions, revocation and tenant isolation.           | IN_PROGRESS |          |
| PRG    | P0       | IAM                     | Implement program management, scope, eligibility and directory. Verify manager and researcher flows. | TODO        |          |
| RPT    | P0       | PRG                     | Implement reports, private evidence, comments and transitions. Verify lifecycle and object access.   | TODO        |          |
| SCORE  | P1       | RPT                     | Implement ledger, rankings, seasons and rewards. Verify concurrent validation and visibility.        | TODO        |          |
| NOTIFY | P1       | RPT                     | Deliver SMTP and webhooks from durable outbox. Verify retries and payload confidentiality.           | IN_PROGRESS |          |
| UX     | P1       | PRG, RPT, SCORE, NOTIFY | Verify complete navigation and responsive workflows in Chromium.                                     | TODO        |          |
| OPS    | P0       | All                     | Verify clean Compose deployment, offline runtime, backup restore, and security regression.           | TODO        |          |
