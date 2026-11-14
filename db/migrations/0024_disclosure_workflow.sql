ALTER TABLE programs ADD COLUMN directory_public boolean NOT NULL DEFAULT false,
 ADD COLUMN disclosure_mode text NOT NULL DEFAULT 'disabled' CHECK (disclosure_mode IN ('disabled','members','public'));
GRANT UPDATE (directory_public, disclosure_mode) ON programs TO bossob_app;

CREATE TABLE disclosure_requests (
 report_id uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','denied','withdrawn')),
 audience text NOT NULL CHECK (audience IN ('members','public')),
 format text NOT NULL CHECK (format IN ('limited','detailed'))
);
ALTER TABLE disclosure_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY disclosure_participants ON disclosure_requests FOR SELECT TO bossob_app USING (
 EXISTS (SELECT FROM reports r WHERE r.id = report_id AND (r.reporter_id = app_actor() OR app_manages_program(r.program_id)))
);
GRANT SELECT ON disclosure_requests TO bossob_app;

ALTER TABLE public_disclosures ADD COLUMN program_id uuid REFERENCES programs(id) ON DELETE CASCADE,
 ADD COLUMN audience text CHECK (audience IN ('members','public')),
 ADD COLUMN format text CHECK (format IN ('limited','detailed'));

DROP POLICY public_disclosure_read ON public_disclosures;
DROP POLICY public_disclosure_admin ON public_disclosures;
REVOKE INSERT, UPDATE, DELETE ON public_disclosures FROM bossob_app;
CREATE POLICY disclosure_snapshot_read ON public_disclosures FOR SELECT TO bossob_app USING (
 audience = 'public' OR (audience = 'members' AND app_program_eligible(program_id))
);

CREATE POLICY disclosure_owner_read ON reports FOR SELECT TO bossob_migrate USING (
 reporter_id = app_actor() OR app_manages_program(program_id)
);
CREATE POLICY disclosure_owner_lock ON reports FOR UPDATE TO bossob_migrate USING (
 reporter_id = app_actor() OR app_manages_program(program_id)
);

CREATE FUNCTION change_disclosure(target uuid, operation text, requested_audience text, requested_format text, heading text, body text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
 r reports%ROWTYPE;
 p programs%ROWTYPE;
 manager boolean;
BEGIN
 SELECT * INTO r FROM reports WHERE id = target FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO p FROM programs WHERE id = r.program_id FOR SHARE;
 manager := app_manages_program(p.id);
 IF app_actor() IS NULL OR NOT (manager OR r.reporter_id = app_actor()) THEN RETURN false; END IF;
 IF operation = 'withdraw' AND manager THEN
   DELETE FROM public_disclosures WHERE id = target AND kind = 'report';
   UPDATE disclosure_requests SET state = 'withdrawn' WHERE report_id = target AND state = 'approved';
 ELSIF operation = 'deny' AND manager THEN
   UPDATE disclosure_requests SET state = 'denied' WHERE report_id = target AND state = 'pending';
   IF NOT FOUND THEN RETURN false; END IF;
 ELSE
   IF r.status NOT IN ('resolved','informative','not_applicable','out_of_scope','duplicate')
      OR p.disclosure_mode = 'disabled'
      OR requested_audience IS NULL OR requested_format IS NULL
      OR requested_audience NOT IN ('members','public')
      OR requested_format NOT IN ('limited','detailed')
      OR (requested_audience = 'public' AND (NOT p.directory_public OR p.disclosure_mode <> 'public' OR p.status <> 'published')) THEN RETURN false; END IF;
   IF operation = 'request' THEN
     INSERT INTO disclosure_requests(report_id,audience,format) VALUES(target,requested_audience,requested_format)
       ON CONFLICT(report_id) DO UPDATE SET state='pending', audience=excluded.audience, format=excluded.format
       WHERE disclosure_requests.state IN ('denied','withdrawn');
     IF NOT FOUND THEN RETURN false; END IF;
   ELSIF operation = 'approve' AND manager THEN
     UPDATE disclosure_requests SET state='approved', audience=requested_audience, format=requested_format
       WHERE report_id=target AND state='pending'
       AND (audience='public' OR requested_audience='members')
       AND (format='detailed' OR requested_format='limited');
     IF NOT FOUND THEN RETURN false; END IF;
     INSERT INTO public_disclosures(id,kind,title,summary,program_id,audience,format)
       VALUES(target,'report',heading,body,p.id,requested_audience,requested_format)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,program_id=excluded.program_id,audience=excluded.audience,format=excluded.format;
   ELSE RETURN false;
   END IF;
 END IF;
 INSERT INTO audit_events(org_id,actor_id,kind,details)
 VALUES(p.org_id,app_actor(),'disclosure.' || operation,jsonb_build_object('reportId',target));
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION change_disclosure(uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION change_disclosure(uuid,text,text,text,text,text) TO bossob_app;

CREATE FUNCTION public_program_directory() RETURNS TABLE(id uuid,title text,summary text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT id,name,description FROM programs WHERE directory_public AND status='published'
$$;
CREATE FUNCTION public_disclosure_allowed(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT FROM programs WHERE id=target AND directory_public AND disclosure_mode='public' AND status='published')
$$;
REVOKE ALL ON FUNCTION public_program_directory(),public_disclosure_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_program_directory(),public_disclosure_allowed(uuid) TO bossob_app;
DROP POLICY disclosure_snapshot_read ON public_disclosures;
CREATE POLICY disclosure_snapshot_read ON public_disclosures FOR SELECT TO bossob_app USING (
 (audience='public' AND public_disclosure_allowed(program_id))
 OR (audience='members' AND app_program_eligible(program_id)
     AND EXISTS (SELECT FROM programs p WHERE p.id = public_disclosures.program_id AND p.disclosure_mode <> 'disabled'))
);
