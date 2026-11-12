-- Manual recognition is attributable to one validated report. Different
-- programs may recognize the same researcher without seeing each other's awards.
-- Locking a report during revocation is permitted even after redaction.
CREATE POLICY manual_achievement_report_lock ON reports FOR UPDATE TO CURRENT_USER
  USING (app_manages_program(program_id));

CREATE FUNCTION app_set_manual_achievement(
  target_report uuid, target_badge text, justification text, revoke boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  target reports%ROWTYPE;
  organization uuid;
  award uuid;
BEGIN
  IF justification IS NULL OR btrim(justification) = ''
    OR char_length(justification) > 500 OR revoke IS NULL
    OR NOT EXISTS (
      SELECT FROM achievement_definitions
      WHERE id = target_badge AND rule->>'type' = 'manual_award'
    )
  THEN
    RAISE EXCEPTION 'Invalid achievement request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO target FROM reports
  WHERE id = target_report AND app_manages_program(program_id)
    AND reporter_id <> app_actor()
    AND reporter_id <> '00000000-0000-4000-8000-000000000010'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('manual-achievement:' || target.reporter_id::text || ':' || target_badge, 0)
  );

  IF revoke THEN
    UPDATE achievement_awards SET revoked_at = now()
    WHERE badge_id = target_badge AND user_id = target.reporter_id
      AND source_key = target.id::text AND program_id = target.program_id
      AND revoked_at IS NULL
    RETURNING id INTO award;
  ELSE
    IF target.status NOT IN ('validated', 'remediation', 'retesting', 'resolved')
      OR target.content_redacted_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'Report is not eligible for recognition' USING ERRCODE = '55000';
    END IF;

    INSERT INTO achievement_awards AS current_award
      (badge_id, user_id, source_key, program_id, seen_at)
    VALUES (target_badge, target.reporter_id, target.id::text, target.program_id,
      (SELECT max(seen_at) FROM achievement_awards
       WHERE badge_id = target_badge AND user_id = target.reporter_id AND revoked_at IS NULL))
    ON CONFLICT (badge_id, user_id, source_key) DO UPDATE
      SET revoked_at = NULL, earned_at = now(), seen_at = excluded.seen_at
      WHERE current_award.revoked_at IS NOT NULL
    RETURNING id INTO award;
  END IF;

  IF award IS NULL THEN RETURN false; END IF;
  INSERT INTO achievement_award_history (award_id, actor_id, action)
  VALUES (award, app_actor(), CASE WHEN revoke THEN 'revoked' ELSE 'earned' END);
  SELECT org_id INTO organization FROM programs WHERE id = target.program_id;
  INSERT INTO audit_events (org_id, actor_id, kind, details)
  VALUES (organization, app_actor(),
    CASE WHEN revoke THEN 'achievement.manual_revoked' ELSE 'achievement.manual_awarded' END,
    jsonb_build_object(
      'awardId', award, 'badgeId', target_badge, 'reportId', target.id,
      'programId', target.program_id, 'reason', justification
    ));
  RETURN true;
END
$$;

REVOKE EXECUTE ON FUNCTION app_set_manual_achievement(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_set_manual_achievement(uuid, text, text, boolean) TO bossob_app;

-- A featured badge is shareable only when its source is already within the
-- viewer's authority. Aggregate milestones may combine confidential sources.
CREATE FUNCTION app_shared_achievements(target_user uuid)
RETURNS TABLE (id text, earned_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT a.badge_id, max(a.earned_at)
  FROM achievement_awards a
  JOIN achievement_definitions d ON d.id = a.badge_id
  JOIN achievement_preferences p ON p.user_id = a.user_id
  JOIN users u ON u.id = a.user_id
  WHERE a.user_id = target_user AND a.revoked_at IS NULL
    AND app_actor() IS NOT NULL AND target_user <> app_actor()
    AND u.leaderboard_visible AND nullif(btrim(u.pseudonym), '') IS NOT NULL
    AND a.badge_id = ANY (p.featured)
    AND (
      (d.rule->>'type' = 'manual_award' AND app_reviews_program(a.program_id))
      OR (d.rule->>'type' = 'final_season_rank'
        AND EXISTS (SELECT FROM platform_settings WHERE global_leaderboard))
    )
  GROUP BY a.badge_id
  ORDER BY a.badge_id
$$;

REVOKE EXECUTE ON FUNCTION app_shared_achievements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_shared_achievements(uuid) TO bossob_app;

CREATE FUNCTION app_manual_achievements_for_report(target_report uuid)
RETURNS TABLE (id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT a.badge_id
  FROM reports r
  JOIN achievement_awards a ON a.source_key = r.id::text
    AND a.program_id = r.program_id AND a.user_id = r.reporter_id
  JOIN achievement_definitions d ON d.id = a.badge_id AND d.rule->>'type' = 'manual_award'
  WHERE r.id = target_report AND app_manages_program(r.program_id)
    AND a.revoked_at IS NULL
  ORDER BY a.badge_id
$$;

REVOKE EXECUTE ON FUNCTION app_manual_achievements_for_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_manual_achievements_for_report(uuid) TO bossob_app;
