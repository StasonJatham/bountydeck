# Decisions

- One application and one worker share the PostgreSQL cluster.
- Platform administration and report oversight are separate grants. Oversight is explicitly granted per organization.
- Auth.js uses its App Router integration and database sessions. The v5 package is distributed under its beta tag.
- Store issuer-scoped OIDC account identifiers without provider access or refresh tokens. Keep application sessions separately revocable.
- Use a private evidence directory and an operator-run retention command. Redaction preserves workflow, audit, and score metadata. A database queue makes file deletion retryable.
- Pin patched Nodemailer and minimatch versions in the lockfile. The minimatch override applies to the ESLint parser dependency only.
