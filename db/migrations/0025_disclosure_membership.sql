CREATE FUNCTION app_disclosure_participant(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app_actor() IS NOT NULL AND EXISTS (
    SELECT FROM programs p WHERE p.id = target AND p.disclosure_mode <> 'disabled' AND (
      app_reviews_program(p.id)
      OR EXISTS (SELECT FROM program_memberships m WHERE m.program_id = p.id AND m.user_id = app_actor())
      OR (p.eligibility = 'organization' AND EXISTS (
        SELECT FROM org_memberships m WHERE m.org_id = p.org_id AND m.user_id = app_actor()
      ))
    )
  )
$$;
REVOKE ALL ON FUNCTION app_disclosure_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_disclosure_participant(uuid) TO bossob_app;

DROP POLICY disclosure_snapshot_read ON public_disclosures;
CREATE POLICY disclosure_snapshot_read ON public_disclosures FOR SELECT TO bossob_app USING (
 (audience = 'public' AND public_disclosure_allowed(program_id))
 OR (audience = 'members' AND app_disclosure_participant(program_id))
);
