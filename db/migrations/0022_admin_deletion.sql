-- The migration owner uses these policies inside the guarded deletion function.
CREATE POLICY admin_delete_reports ON reports TO bossob_migrate USING (app_platform_admin());
CREATE POLICY admin_delete_comments ON report_comments TO bossob_migrate USING (app_platform_admin());
CREATE POLICY admin_delete_events ON report_events TO bossob_migrate USING (app_platform_admin());

CREATE FUNCTION admin_delete_record(record_kind text, record_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  program uuid;
  organization uuid;
BEGIN
  IF NOT app_platform_admin() THEN RETURN false; END IF;

  IF record_kind = 'report' THEN
    SELECT program_id INTO program FROM reports WHERE id = record_id FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    SELECT org_id INTO organization FROM programs WHERE id = program;
    IF EXISTS (SELECT FROM achievement_awards WHERE program_id = program AND source_key = record_id::text)
       OR EXISTS (SELECT FROM public_disclosures WHERE kind = 'report' AND id = record_id) THEN
      RAISE foreign_key_violation USING MESSAGE = 'Report has retained history';
    END IF;
    DELETE FROM report_comments WHERE report_id = record_id;
    DELETE FROM report_events WHERE report_id = record_id;
    DELETE FROM reports WHERE id = record_id;
  ELSIF record_kind = 'program' THEN
    SELECT org_id INTO organization FROM programs WHERE id = record_id AND status IN ('draft', 'archived') FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF EXISTS (SELECT FROM reports WHERE program_id = record_id)
       OR EXISTS (SELECT FROM notification_outbox WHERE program_id = record_id)
       OR EXISTS (SELECT FROM public_disclosures WHERE kind = 'program' AND id = record_id) THEN
      RAISE foreign_key_violation USING MESSAGE = 'Program has retained history';
    END IF;
    DELETE FROM program_memberships WHERE program_id = record_id;
    DELETE FROM program_scopes WHERE program_id = record_id;
    DELETE FROM rewards WHERE program_id = record_id;
    DELETE FROM notification_channels WHERE program_id = record_id;
    DELETE FROM programs WHERE id = record_id;
  ELSE
    RETURN false;
  END IF;

  INSERT INTO audit_events (org_id, actor_id, kind, details)
  VALUES (organization, app_actor(), record_kind || '.deleted', jsonb_build_object('id', record_id));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION admin_delete_record(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_delete_record(text, uuid) TO bossob_app;
