-- Run with psql as a fixture administrator against a disposable migrated database.
BEGIN;
INSERT INTO users (id, platform_role) VALUES ('00000000-0000-0000-0000-000000000021','admin'), ('00000000-0000-0000-0000-000000000022','researcher');
INSERT INTO org_units (id,name,slug) VALUES ('00000000-0000-0000-0000-000000000023','Deletion fixture','deletion-fixture');
INSERT INTO programs (id,org_id,name,slug) VALUES ('00000000-0000-0000-0000-000000000024','00000000-0000-0000-0000-000000000023','Deletion fixture','deletion-fixture');
INSERT INTO program_scopes (id,program_id,name) VALUES ('00000000-0000-0000-0000-000000000025','00000000-0000-0000-0000-000000000024','fixture');
INSERT INTO reports (id,program_id,reporter_id,asset_id,title,description,cwe,steps,impact,proposed_severity)
VALUES ('00000000-0000-0000-0000-000000000026','00000000-0000-0000-0000-000000000024','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000025','Title','Description','CWE-200','Steps','Impact','low');
INSERT INTO report_attachments (id,report_id,uploaded_by,name,media_type,size)
VALUES ('00000000-0000-0000-0000-000000000027','00000000-0000-0000-0000-000000000026','00000000-0000-0000-0000-000000000022','fixture.txt','text/plain',5);
SET LOCAL ROLE bossob_app;
SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000022',true);
DO $$
BEGIN
  IF admin_delete_record('report','00000000-0000-0000-0000-000000000026') THEN
    RAISE EXCEPTION 'Researcher deleted report';
  END IF;
END
$$;
SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000021',true);
DO $$
BEGIN
  BEGIN
    PERFORM admin_delete_record('program','00000000-0000-0000-0000-000000000024');
    RAISE EXCEPTION 'Program with reports was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    PERFORM admin_delete_record('report','00000000-0000-0000-0000-000000000026');
    RAISE EXCEPTION 'Report with evidence was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$$;
RESET ROLE;
DELETE FROM report_attachments WHERE id = '00000000-0000-0000-0000-000000000027';
SET LOCAL ROLE bossob_app;
DO $$
BEGIN
  IF NOT admin_delete_record('report','00000000-0000-0000-0000-000000000026') OR
     NOT admin_delete_record('program','00000000-0000-0000-0000-000000000024') THEN
    RAISE EXCEPTION 'Admin could not delete records';
  END IF;
  IF (SELECT count(*) FROM audit_events WHERE kind IN ('report.deleted','program.deleted')
      AND actor_id = '00000000-0000-0000-0000-000000000021') <> 2 THEN
    RAISE EXCEPTION 'Expected two deletion audit events';
  END IF;
END
$$;
ROLLBACK;
