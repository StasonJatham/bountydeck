ALTER TABLE score_events ADD COLUMN award_severity text
  CHECK (award_severity IN ('none', 'low', 'medium', 'high', 'critical'));

CREATE FUNCTION snapshot_award_severity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.kind = 'award' THEN
    SELECT severity INTO NEW.award_severity FROM reports WHERE id = NEW.report_id;
  ELSE
    NEW.award_severity := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION snapshot_award_severity() FROM PUBLIC;

CREATE TRIGGER snapshot_award_severity
BEFORE INSERT ON score_events FOR EACH ROW EXECUTE FUNCTION snapshot_award_severity();

CREATE FUNCTION app_personal_seasons()
RETURNS TABLE (period text, starts_at timestamptz, ends_at timestamptz, points bigint, standing bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH buckets AS (
    SELECT score.user_id, score.points,
      windows.period,
      date_trunc(windows.period, score.created_at AT TIME ZONE 'UTC') AS starts_at,
      p.status IN ('published', 'paused') AND p.eligibility = 'all' AND p.leaderboard_visibility <> 'hidden' AS public_score
    FROM score_events score
    JOIN programs p ON p.id = score.program_id
    JOIN users u ON u.id = score.user_id
    CROSS JOIN (VALUES ('quarter'), ('year')) AS windows(period)
    WHERE app_actor() IS NOT NULL AND (score.user_id = app_actor() OR u.leaderboard_visible)
  ), own AS (
    SELECT buckets.period, buckets.starts_at, sum(buckets.points) AS points
    FROM buckets WHERE buckets.user_id = app_actor()
    GROUP BY buckets.period, buckets.starts_at
  ), public_totals AS (
    SELECT buckets.period, buckets.starts_at, buckets.user_id, sum(buckets.points) AS points
    FROM buckets WHERE buckets.public_score
    GROUP BY buckets.period, buckets.starts_at, buckets.user_id
  ), ranked AS (
    SELECT public_totals.*,
      rank() OVER (PARTITION BY public_totals.period, public_totals.starts_at ORDER BY public_totals.points DESC) AS standing
    FROM public_totals
  )
  SELECT own.period, own.starts_at AT TIME ZONE 'UTC',
    (own.starts_at + CASE own.period WHEN 'quarter' THEN interval '3 months' ELSE interval '1 year' END) AT TIME ZONE 'UTC',
    own.points, ranked.standing
  FROM own
  LEFT JOIN ranked ON ranked.period = own.period AND ranked.starts_at = own.starts_at AND ranked.user_id = app_actor()
  ORDER BY own.starts_at DESC, own.period
  LIMIT 101
$$;

REVOKE EXECUTE ON FUNCTION app_personal_seasons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_personal_seasons() TO bossob_app;

CREATE FUNCTION audit_profile_privacy() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_user = 'bossob_app' THEN
    IF app_actor() IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'Profile privacy changes require the owning actor' USING ERRCODE = '42501';
    END IF;

    INSERT INTO audit_events (actor_id, kind, details)
    VALUES (
      NEW.id, 'profile.privacy_changed',
      jsonb_build_object('visible', NEW.leaderboard_visible, 'pseudonym_changed', NEW.pseudonym IS DISTINCT FROM OLD.pseudonym)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION audit_profile_privacy() FROM PUBLIC;

CREATE TRIGGER audit_profile_privacy
AFTER UPDATE OF pseudonym, leaderboard_visible ON users
FOR EACH ROW WHEN (
  OLD.pseudonym IS DISTINCT FROM NEW.pseudonym OR OLD.leaderboard_visible IS DISTINCT FROM NEW.leaderboard_visible
) EXECUTE FUNCTION audit_profile_privacy();
