-- Run with psql as a fixture administrator against a disposable migrated database.
BEGIN;
INSERT INTO users (id, platform_role) VALUES ('00000000-0000-0000-0000-000000000031','researcher');
INSERT INTO org_units (id,name,slug) VALUES ('00000000-0000-0000-0000-000000000032','Disclosure fixture','disclosure-fixture');
INSERT INTO programs (id,org_id,name,slug,status,eligibility,disclosure_mode)
VALUES ('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000032','Disclosure fixture','disclosure-fixture','published','all','members');
INSERT INTO public_disclosures (id,kind,title,summary,program_id,audience,format)
VALUES ('00000000-0000-0000-0000-000000000034','report','Fixture','Summary','00000000-0000-0000-0000-000000000033','members','limited');
SET LOCAL ROLE bossob_app;
SELECT set_config('app.actor_id','00000000-0000-0000-0000-000000000031',true);
DO $$
BEGIN
  IF NOT app_program_eligible('00000000-0000-0000-0000-000000000033')
     OR EXISTS (SELECT FROM public_disclosures WHERE id = '00000000-0000-0000-0000-000000000034') THEN
    RAISE EXCEPTION 'Submission eligibility exposed a participant-only disclosure';
  END IF;
END
$$;
RESET ROLE;
INSERT INTO program_memberships(program_id,user_id,role)
VALUES ('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000031','researcher');
SET LOCAL ROLE bossob_app;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM public_disclosures WHERE id = '00000000-0000-0000-0000-000000000034') THEN
    RAISE EXCEPTION 'Program participant could not read its disclosure';
  END IF;
END
$$;
ROLLBACK;
