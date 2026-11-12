\set ON_ERROR_STOP on
BEGIN;

-- Run with psql as a test database administrator. Everything rolls back.
INSERT INTO users (id, name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Notification researcher'),
  ('10000000-0000-0000-0000-000000000002', 'Notification manager'),
  ('10000000-0000-0000-0000-000000000003', 'Unrelated researcher');
INSERT INTO org_units (id, name, slug) VALUES
  ('10000000-0000-0000-0000-000000000004', 'Notification test unit', 'notification-test-unit');
INSERT INTO programs (id, org_id, name, slug, status, eligibility) VALUES
  ('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004',
   'Notification test program', 'notification-test-program', 'published', 'all');
INSERT INTO program_memberships (program_id, user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'manager');
INSERT INTO program_scopes (id, program_id, name) VALUES
  ('10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000005', 'Test scope');

SET LOCAL ROLE bossob_app;
SELECT set_config('app.actor_id', '10000000-0000-0000-0000-000000000002', true);
INSERT INTO notification_channels (id, program_id, kind, destination, subscribed_events, severities) VALUES
  ('10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000005',
   'smtp', 'test@internal.example',
   ARRAY['report.submitted','report.comment_added','report.validated','report.status_changed',
         'report.severity_changed','report.assigned','report.resolved'], '{}'),
  ('10000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000005',
   'smtp', 'other@internal.example', ARRAY['report.submitted','report.validated'], ARRAY['high']);

SELECT set_config('app.actor_id', '10000000-0000-0000-0000-000000000001', true);
INSERT INTO reports (id, program_id, reporter_id, asset_id, title, description, cwe, steps, impact, proposed_severity)
VALUES ('10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000005',
        '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006',
        'Fixture', 'Fixture', 'CWE-20', 'Fixture', 'Fixture', 'high');
INSERT INTO report_comments (report_id, author_id, body) VALUES
  ('10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'Public fixture');

DO $$
BEGIN
  IF EXISTS (SELECT FROM notification_outbox) THEN
    RAISE EXCEPTION 'Researcher could read notification jobs';
  END IF;
  IF public.test_notification('10000000-0000-0000-0000-000000000007') THEN
    RAISE EXCEPTION 'Researcher could test a manager channel';
  END IF;
END;
$$;

SELECT set_config('app.actor_id', '10000000-0000-0000-0000-000000000002', true);
INSERT INTO report_comments (report_id, author_id, body, internal) VALUES
  ('10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'Private fixture', true);
UPDATE reports SET severity = 'high', status = 'validated',
  assignee_id = '10000000-0000-0000-0000-000000000002'
WHERE id = '10000000-0000-0000-0000-000000000009';
UPDATE reports SET status = 'resolved' WHERE id = '10000000-0000-0000-0000-000000000009';

DO $$
DECLARE
  events text[];
BEGIN
  SELECT array_agg(event_type ORDER BY event_type) INTO events FROM notification_outbox
    WHERE channel_id = '10000000-0000-0000-0000-000000000007';
  IF events IS DISTINCT FROM ARRAY['report.assigned','report.comment_added','report.resolved',
    'report.severity_changed','report.status_changed','report.status_changed','report.submitted','report.validated'] THEN
    RAISE EXCEPTION 'Unexpected event subscriptions or private note disclosure: %', events;
  END IF;
  SELECT array_agg(event_type ORDER BY event_type) INTO events FROM notification_outbox
    WHERE channel_id = '10000000-0000-0000-0000-000000000008';
  IF events IS DISTINCT FROM ARRAY['report.validated'] THEN
    RAISE EXCEPTION 'Severity filter failed: %', events;
  END IF;
  IF NOT public.test_notification('10000000-0000-0000-0000-000000000007') THEN
    RAISE EXCEPTION 'Manager could not queue test';
  END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE bossob_worker;
UPDATE notification_outbox SET status = 'dead', attempts = 1, retry_count = 1
WHERE event_type = 'notification.test'
  AND channel_id = '10000000-0000-0000-0000-000000000007';

RESET ROLE;
SET LOCAL ROLE bossob_app;
DO $$
DECLARE
  job uuid;
BEGIN
  SELECT id INTO STRICT job FROM notification_outbox WHERE event_type = 'notification.test'
    AND channel_id = '10000000-0000-0000-0000-000000000007';
  PERFORM set_config('app.actor_id', '10000000-0000-0000-0000-000000000003', true);
  IF public.retry_notification(job) THEN RAISE EXCEPTION 'Unrelated actor could retry'; END IF;

  PERFORM set_config('app.actor_id', '10000000-0000-0000-0000-000000000002', true);
  IF NOT public.retry_notification(job) THEN RAISE EXCEPTION 'Manager could not retry'; END IF;
  IF NOT EXISTS (SELECT FROM notification_outbox WHERE id = job AND status = 'pending'
    AND attempts = 1 AND retry_count = 0) THEN
    RAISE EXCEPTION 'Manual retry lost attempt history or did not reset retry count';
  END IF;
  UPDATE notification_channels SET destination = 'new@internal.example'
  WHERE id = '10000000-0000-0000-0000-000000000007';
  IF NOT EXISTS (
    SELECT FROM notification_outbox o JOIN notification_channels c ON c.id = o.channel_id
    WHERE o.id = job AND o.routing_revision <> c.routing_revision
  ) THEN
    RAISE EXCEPTION 'Destination change did not invalidate queued route';
  END IF;
END;
$$;

ROLLBACK;
