---
name: bountydeck-program-management
description: Inspect BountyDeck program configuration and carry out explicitly authorized changes to program rules, membership, or settings using the deployment's supported integration operations.
---

# Manage a program

1. Authenticate and inspect `GET /api/v1/identity` or `bountydeck_get_identity`. Confirm the target organization and program with `GET /api/v1/programs` or `bountydeck_list_programs`.
2. Read the authenticated OpenAPI contract or discover the MCP tools. Use the documented operation for the exact configuration change the operator requests. `PATCH /api/v1/programs/{programId}` replaces program settings. Read the current settings first and preserve fields outside the requested change.
3. Resolve membership changes to a specific user ID, role, and program. Confirm configuration changes against the current record and verify the resulting state after the update.

Apply changes within the requested scope. Program roles and organization roles carry different access. Do not use a platform administrator identity as a substitute for an integration's scoped role. If a request is denied, report the denial without retrying under another identity.
