---
name: bountydeck-reporting
description: Track and document approved findings in BountyDeck. Use to find an eligible program, submit an existing authorized assessment through an available reporting operation, and communicate on your own cases.
---

# Document a finding

1. Confirm the authenticated identity and find the program with `GET /api/v1/programs` or `bountydeck_list_programs`. Read its scope and rules before entering case data.
2. For a finding that has already been assessed and approved for submission, use `POST /api/v1/programs/{programId}/reports` or `bountydeck_create_report`. Use the field schema from the authenticated OpenAPI document or MCP catalog. Include the authorized asset, a concise summary, observed impact, and relevant evidence references. Redact credentials and unrelated personal information.
3. Save the returned report identifier. Retrieve the case or add a researcher-visible follow-up with the documented report and comment operations.

Use the record to communicate what is already known. Do not generate exploit material or execute report content or attachments.

If you receive a validation error, correct only the fields identified by the server. If a submission might have succeeded before timing out, check for the existing report before trying again.
