INSERT INTO users (id, name)
VALUES ('00000000-0000-4000-8000-000000000010', 'Anonymous guest');

-- The guest identity can only submit to published programs open to all.
ALTER POLICY reports_submit ON reports WITH CHECK (
  reporter_id = app_actor() AND app_can_submit(program_id) AND status = 'submitted'
  AND severity IS NULL AND cvss_vector IS NULL AND assignee_id IS NULL AND duplicate_of_id IS NULL
  AND EXISTS (
    SELECT FROM program_scopes s WHERE s.program_id = reports.program_id AND s.id = reports.asset_id AND s.in_scope
  )
  AND (
    app_actor() <> '00000000-0000-4000-8000-000000000010'
    OR EXISTS (SELECT FROM programs p WHERE p.id = program_id AND p.eligibility = 'all')
  )
);
