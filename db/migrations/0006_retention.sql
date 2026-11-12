ALTER TABLE reports ADD COLUMN content_redacted_at timestamptz;

ALTER POLICY reports_review ON reports
  USING (content_redacted_at IS NULL AND app_reviews_program(program_id));
ALTER POLICY comments_write ON report_comments WITH CHECK (
  author_id = app_actor()
  AND EXISTS (SELECT FROM reports WHERE id = report_id AND content_redacted_at IS NULL)
  AND (NOT internal OR app_report_review(report_id))
);
ALTER POLICY attachments_write ON report_attachments WITH CHECK (
  uploaded_by = app_actor()
  AND EXISTS (SELECT FROM reports WHERE id = report_id AND content_redacted_at IS NULL)
);

CREATE TABLE evidence_gc (
  storage_key uuid PRIMARY KEY
);
REVOKE ALL ON evidence_gc FROM PUBLIC, bossob_app, bossob_worker;
