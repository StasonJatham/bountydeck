# Decisions

- One application and one worker share the PostgreSQL cluster.
- Platform administration and report oversight are separate grants. Oversight is explicitly granted per organization.
- Auth.js uses its App Router integration and database sessions. The v5 package is distributed under its beta tag.
