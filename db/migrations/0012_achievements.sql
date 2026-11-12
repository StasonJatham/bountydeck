CREATE TABLE achievement_definitions (
  id text PRIMARY KEY,
  rule jsonb NOT NULL,
  catalog_version integer NOT NULL CHECK (catalog_version > 0)
);

CREATE TABLE achievement_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id text NOT NULL REFERENCES achievement_definitions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  source_key text NOT NULL DEFAULT '',
  program_id uuid REFERENCES programs(id),
  earned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  seen_at timestamptz,
  UNIQUE (badge_id, user_id, source_key)
);
CREATE INDEX achievement_awards_user ON achievement_awards (user_id);

CREATE TABLE achievement_award_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  award_id uuid NOT NULL REFERENCES achievement_awards(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('earned', 'revoked')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE achievement_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  featured text[] NOT NULL DEFAULT '{}' CHECK (cardinality(featured) <= 3)
);

CREATE TABLE achievement_season_snapshots (
  period text NOT NULL CHECK (period IN ('quarter', 'year')),
  starts_on date NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT now(),
  finalized_by uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (period, starts_on)
);

CREATE TABLE achievement_season_rankings (
  period text NOT NULL,
  starts_on date NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  points bigint NOT NULL,
  standing bigint NOT NULL,
  PRIMARY KEY (period, starts_on, user_id),
  FOREIGN KEY (period, starts_on) REFERENCES achievement_season_snapshots (period, starts_on)
);

-- These owner-only policies let narrowly scoped SECURITY DEFINER functions
-- aggregate reports across reviewer boundaries without exposing the source rows.
CREATE POLICY achievements_owner_reports_read ON reports FOR SELECT TO CURRENT_USER USING (true);
CREATE POLICY achievements_owner_events_read ON report_events FOR SELECT TO CURRENT_USER USING (true);
CREATE POLICY achievements_owner_events_write ON report_events FOR INSERT TO CURRENT_USER
  WITH CHECK (
    actor_id = app_actor() AND kind = 'report.reproducibility_changed' AND internal
    AND app_report_review(report_id)
  );

ALTER TABLE reports ADD COLUMN achievement_validated_at timestamptz;
ALTER TABLE reports ADD COLUMN repro_verified boolean NOT NULL DEFAULT false;

CREATE POLICY achievements_backfill ON reports FOR UPDATE TO CURRENT_USER USING (true);
UPDATE reports r SET achievement_validated_at = coalesce(
  (SELECT max(created_at) FROM report_events WHERE report_id = r.id AND kind = 'report.validated'),
  (SELECT created_at FROM score_events WHERE report_id = r.id AND kind = 'award'),
  r.updated_at
)
WHERE r.status IN ('validated', 'remediation', 'retesting', 'resolved');
DROP POLICY achievements_backfill ON reports;
CREATE POLICY achievements_owner_reports_repro ON reports FOR UPDATE TO CURRENT_USER
  USING (content_redacted_at IS NULL AND app_reviews_program(program_id));

CREATE FUNCTION app_achievement_report_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status IN ('validated', 'remediation', 'retesting', 'resolved') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.achievement_validated_at := coalesce(NEW.achievement_validated_at, now());
    ELSIF OLD.status NOT IN ('validated', 'remediation', 'retesting', 'resolved') THEN
      NEW.achievement_validated_at := now();
    END IF;
  ELSE
    NEW.achievement_validated_at := NULL;
    NEW.repro_verified := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER achievement_report_stamp BEFORE INSERT OR UPDATE OF status ON reports
FOR EACH ROW EXECUTE FUNCTION app_achievement_report_stamp();

CREATE FUNCTION app_achievement_metrics(target uuid)
RETURNS TABLE (user_id uuid, metrics jsonb)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  WITH report_totals AS (
    SELECT r.reporter_id,
      count(*) AS validated_reports,
      count(*) FILTER (WHERE r.severity IN ('high', 'critical')) AS validated_reports_min_severity,
      count(*) FILTER (WHERE r.severity = 'critical') AS validated_reports_exact_severity_critical,
      count(DISTINCT r.severity) AS distinct_validated_severity_bands,
      count(DISTINCT r.program_id) AS distinct_programs_with_validated_reports,
      count(DISTINCT p.org_id) AS distinct_org_units_with_validated_reports,
      count(DISTINCT nullif(r.cwe, '')) AS distinct_cwe_in_validated_reports,
      count(*) FILTER (WHERE r.repro_verified) AS triager_verified_repro_count,
      count(DISTINCT date_trunc('month', r.achievement_validated_at, 'UTC')) AS distinct_months_with_validated_reports,
      count(DISTINCT date_trunc('quarter', r.achievement_validated_at, 'UTC')) AS distinct_seasons_with_validated_reports
    FROM reports r JOIN programs p ON p.id = r.program_id
    WHERE r.status IN ('validated', 'remediation', 'retesting', 'resolved')
      AND (target IS NULL OR r.reporter_id = target)
    GROUP BY r.reporter_id
  ), ledger_totals AS (
    SELECT s.user_id, sum(s.points) AS lifetime_points
    FROM score_events s
    WHERE target IS NULL OR s.user_id = target
    GROUP BY s.user_id
  )
  SELECT coalesce(report_totals.reporter_id, ledger_totals.user_id),
    (coalesce(to_jsonb(report_totals), '{}'::jsonb) - 'reporter_id')
      || jsonb_build_object('lifetime_points', greatest(0, ledger_totals.lifetime_points))
  FROM report_totals FULL JOIN ledger_totals ON ledger_totals.user_id = report_totals.reporter_id
  WHERE coalesce(report_totals.reporter_id, ledger_totals.user_id) <> '00000000-0000-4000-8000-000000000010';
$$;

-- Lock the transaction, then read committed metrics in a separate statement.
-- ponytail: a single transaction lock serializes achievement writes, including bulk reconciliation.
CREATE FUNCTION app_achievement_refresh(target uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed integer;
BEGIN
  PERFORM pg_advisory_xact_lock(1764138568, 12);
  WITH eligible AS MATERIALIZED (
    SELECT m.user_id, d.id
    FROM app_achievement_metrics(target) m CROSS JOIN achievement_definitions d
    WHERE coalesce((m.metrics ->> (d.rule ->> 'type'))::bigint, 0) >= (d.rule ->> 'threshold')::integer
  ), earned AS (
    INSERT INTO achievement_awards (user_id, badge_id)
    SELECT user_id, id FROM eligible
    ON CONFLICT (badge_id, user_id, source_key) DO UPDATE
      SET revoked_at = NULL, earned_at = now(), seen_at = NULL
      WHERE achievement_awards.revoked_at IS NOT NULL
    RETURNING id
  ), revoked AS (
    UPDATE achievement_awards a SET revoked_at = now()
    WHERE a.source_key = '' AND a.revoked_at IS NULL
      AND (target IS NULL OR a.user_id = target)
      AND NOT EXISTS (SELECT FROM eligible e WHERE e.user_id = a.user_id AND e.id = a.badge_id)
    RETURNING id
  )
  INSERT INTO achievement_award_history (award_id, actor_id, action)
    SELECT id, app_actor(), 'earned' FROM earned
    UNION ALL SELECT id, app_actor(), 'revoked' FROM revoked;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

CREATE FUNCTION app_achievement_refresh_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'score_events' THEN
    PERFORM app_achievement_refresh(NEW.user_id);
  ELSE
    PERFORM app_achievement_refresh(NEW.reporter_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER achievement_reports_insert AFTER INSERT ON reports
FOR EACH ROW WHEN (NEW.status IN ('validated', 'remediation', 'retesting', 'resolved'))
EXECUTE FUNCTION app_achievement_refresh_trigger();
CREATE TRIGGER achievement_reports_update AFTER UPDATE OF status, severity, repro_verified ON reports
FOR EACH ROW WHEN (
  OLD.achievement_validated_at IS DISTINCT FROM NEW.achievement_validated_at
  OR OLD.repro_verified IS DISTINCT FROM NEW.repro_verified
  OR (NEW.achievement_validated_at IS NOT NULL AND OLD.severity IS DISTINCT FROM NEW.severity)
) EXECUTE FUNCTION app_achievement_refresh_trigger();
CREATE TRIGGER achievement_ledger_insert AFTER INSERT ON score_events
FOR EACH ROW EXECUTE FUNCTION app_achievement_refresh_trigger();

CREATE FUNCTION app_achievement_progress() RETURNS TABLE (badge_id text, progress bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.id, coalesce((m.metrics ->> (d.rule ->> 'type'))::bigint, 0)
  FROM achievement_definitions d LEFT JOIN app_achievement_metrics(app_actor()) m ON m.user_id = app_actor()
  WHERE app_actor() IS NOT NULL AND d.rule ? 'threshold';
$$;

CREATE FUNCTION app_achievement_awards()
RETURNS TABLE (award_id uuid, badge_id text, earned_at timestamptz, season text, featured boolean, seen boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH active AS (
    SELECT a.*, CASE WHEN d.rule ->> 'type' = 'final_season_rank' THEN a.source_key END AS season
    FROM achievement_awards a JOIN achievement_definitions d ON d.id = a.badge_id
    WHERE a.user_id = app_actor() AND a.revoked_at IS NULL
  ), distinct_awards AS (
    SELECT DISTINCT ON (badge_id, season) id, badge_id, earned_at, season,
      bool_or(seen_at IS NOT NULL) OVER (PARTITION BY badge_id, season) AS seen
    FROM active ORDER BY badge_id, season, earned_at, id
  )
  SELECT a.id, a.badge_id, a.earned_at, a.season,
    coalesce(a.badge_id = ANY(p.featured), false), a.seen
  FROM distinct_awards a LEFT JOIN achievement_preferences p ON p.user_id = app_actor()
  ORDER BY a.earned_at DESC, a.id;
$$;

CREATE FUNCTION app_achievement_feature(badges text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app_actor() IS NULL OR badges IS NULL OR cardinality(badges) > 3 OR
    (SELECT count(DISTINCT badge) FROM unnest(badges) badge) <> cardinality(badges)
    OR EXISTS (
      SELECT FROM unnest(badges) badge WHERE NOT EXISTS (
        SELECT FROM achievement_awards a
        WHERE a.user_id = app_actor() AND a.badge_id = badge AND a.revoked_at IS NULL
      )
    ) THEN
    RAISE EXCEPTION 'Only earned achievements can be featured' USING ERRCODE = '42501';
  END IF;
  INSERT INTO achievement_preferences (user_id, featured) VALUES (app_actor(), badges)
  ON CONFLICT (user_id) DO UPDATE SET featured = excluded.featured;
END;
$$;

CREATE FUNCTION app_achievement_seen(awards uuid[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH acknowledged AS (
    SELECT a.id, a.badge_id, d.rule ->> 'type' = 'manual_award' AS manual
    FROM achievement_awards a JOIN achievement_definitions d ON d.id = a.badge_id
    WHERE a.user_id = app_actor() AND a.id = ANY(awards)
  )
  UPDATE achievement_awards a SET seen_at = now()
  WHERE a.user_id = app_actor() AND a.revoked_at IS NULL AND a.seen_at IS NULL
    AND EXISTS (
      SELECT FROM acknowledged r WHERE a.id = r.id OR (r.manual AND a.badge_id = r.badge_id)
    );
$$;

CREATE FUNCTION app_achievement_verify_repro(target uuid, verified boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE program uuid;
BEGIN
  SELECT program_id INTO program FROM reports
  WHERE id = target AND content_redacted_at IS NULL AND reporter_id <> app_actor()
    AND status IN ('validated', 'remediation', 'retesting', 'resolved')
    AND app_reviews_program(program_id)
  FOR UPDATE;
  IF NOT FOUND OR verified IS NULL THEN
    RAISE EXCEPTION 'Validated report unavailable' USING ERRCODE = '42501';
  END IF;
  UPDATE reports SET repro_verified = verified
  WHERE id = target AND repro_verified IS DISTINCT FROM verified;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO report_events (report_id, actor_id, kind, internal, details)
  VALUES (target, app_actor(), 'report.reproducibility_changed', true, jsonb_build_object('verified', verified));
  INSERT INTO audit_events (org_id, actor_id, kind, details)
  SELECT org_id, app_actor(), 'report.reproducibility_changed', jsonb_build_object('report_id', target, 'verified', verified)
  FROM programs WHERE id = program;
  RETURN true;
END;
$$;

CREATE FUNCTION app_achievement_reconcile() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE changed integer;
BEGIN
  IF NOT app_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501';
  END IF;
  changed := app_achievement_refresh(NULL);
  INSERT INTO audit_events (actor_id, kind, details)
    VALUES (app_actor(), 'achievements.reconciled', jsonb_build_object('changed', changed));
  RETURN changed;
END;
$$;

CREATE FUNCTION app_achievement_finalize(season_period text, season_start date) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE season_end date;
BEGIN
  IF NOT app_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501';
  END IF;
  IF season_period IS NULL OR season_period NOT IN ('quarter', 'year') OR season_start IS NULL
    OR date_trunc(season_period, season_start::timestamp)::date <> season_start THEN
    RAISE EXCEPTION 'Invalid UTC season boundary' USING ERRCODE = '22023';
  END IF;
  season_end := season_start + CASE season_period WHEN 'quarter' THEN interval '3 months' ELSE interval '1 year' END;
  IF season_end > (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Only completed seasons can be finalized' USING ERRCODE = '22023';
  END IF;
  IF NOT (SELECT global_leaderboard FROM platform_settings) THEN
    RAISE EXCEPTION 'Global leaderboard is disabled' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(1764138568, 12);
  INSERT INTO achievement_season_snapshots (period, starts_on, finalized_by)
  VALUES (season_period, season_start, app_actor()) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO achievement_season_rankings (period, starts_on, user_id, points, standing)
  SELECT season_period, season_start, s.user_id, sum(s.points),
    rank() OVER (ORDER BY sum(s.points) DESC)
  FROM score_events s
  JOIN users u ON u.id = s.user_id
  JOIN programs p ON p.id = s.program_id
  WHERE u.leaderboard_visible AND p.eligibility = 'all'
    AND p.status IN ('published', 'paused') AND p.leaderboard_visibility <> 'hidden'
    AND s.created_at >= (season_start::timestamp AT TIME ZONE 'UTC')
    AND s.created_at < (season_end::timestamp AT TIME ZONE 'UTC')
  GROUP BY s.user_id;

  WITH earned AS (
    INSERT INTO achievement_awards (badge_id, user_id, source_key)
    SELECT d.id, r.user_id, season_period || ':' || to_char(season_start, 'YYYY-MM-DD')
    FROM achievement_season_rankings r CROSS JOIN achievement_definitions d
    WHERE r.period = season_period AND r.starts_on = season_start
      AND d.rule ->> 'type' = 'final_season_rank' AND d.rule ->> 'period' = season_period
      AND r.standing <= (d.rule ->> 'max_rank')::integer
    RETURNING id
  )
  INSERT INTO achievement_award_history (award_id, actor_id, action)
  SELECT id, app_actor(), 'earned' FROM earned;

  INSERT INTO audit_events (actor_id, kind, details)
  VALUES (app_actor(), 'achievements.season_finalized',
    jsonb_build_object('period', season_period, 'starts_on', season_start));
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION app_achievement_report_stamp(), app_achievement_metrics(uuid),
  app_achievement_refresh(uuid), app_achievement_refresh_trigger(), app_achievement_progress(),
  app_achievement_awards(), app_achievement_feature(text[]), app_achievement_seen(uuid[]),
  app_achievement_verify_repro(uuid, boolean), app_achievement_reconcile(),
  app_achievement_finalize(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_achievement_progress(), app_achievement_awards(),
  app_achievement_feature(text[]), app_achievement_seen(uuid[]), app_achievement_verify_repro(uuid, boolean),
  app_achievement_reconcile(), app_achievement_finalize(text, date) TO bossob_app;

-- Generated from lib/achievements/catalog.json, preserved here as a versioned seed.
INSERT INTO achievement_definitions (id, rule, catalog_version) VALUES
  ('first-signal', '{"type":"validated_reports","threshold":1}'::jsonb, 1),
  ('steady-hand', '{"type":"validated_reports","threshold":5}'::jsonb, 1),
  ('bug-hunter', '{"type":"validated_reports","threshold":10}'::jsonb, 1),
  ('bug-veteran', '{"type":"validated_reports","threshold":25}'::jsonb, 1),
  ('bug-legend', '{"type":"validated_reports","threshold":50}'::jsonb, 1),
  ('high-voltage', '{"type":"validated_reports_min_severity","threshold":1}'::jsonb, 1),
  ('critical-hit', '{"type":"validated_reports_exact_severity_critical","threshold":1}'::jsonb, 1),
  ('critical-mass', '{"type":"validated_reports_exact_severity_critical","threshold":3}'::jsonb, 1),
  ('impact-maker', '{"type":"validated_reports_min_severity","threshold":10}'::jsonb, 1),
  ('full-spectrum', '{"type":"distinct_validated_severity_bands","threshold":3}'::jsonb, 1),
  ('spark-250', '{"type":"lifetime_points","threshold":250}'::jsonb, 1),
  ('one-k-club', '{"type":"lifetime_points","threshold":1000}'::jsonb, 1),
  ('momentum', '{"type":"lifetime_points","threshold":2500}'::jsonb, 1),
  ('five-k-club', '{"type":"lifetime_points","threshold":5000}'::jsonb, 1),
  ('orbit', '{"type":"lifetime_points","threshold":10000}'::jsonb, 1),
  ('pathfinder', '{"type":"distinct_programs_with_validated_reports","threshold":2}'::jsonb, 1),
  ('explorer', '{"type":"distinct_programs_with_validated_reports","threshold":5}'::jsonb, 1),
  ('bridge-builder', '{"type":"distinct_org_units_with_validated_reports","threshold":2}'::jsonb, 1),
  ('pattern-reader', '{"type":"distinct_cwe_in_validated_reports","threshold":3}'::jsonb, 1),
  ('deep-diver', '{"type":"distinct_cwe_in_validated_reports","threshold":5}'::jsonb, 1),
  ('repro-ready', '{"type":"triager_verified_repro_count","threshold":1}'::jsonb, 1),
  ('repro-pro', '{"type":"triager_verified_repro_count","threshold":5}'::jsonb, 1),
  ('clear-signal', '{"type":"manual_award"}'::jsonb, 1),
  ('team-player', '{"type":"manual_award"}'::jsonb, 1),
  ('back-again', '{"type":"distinct_months_with_validated_reports","threshold":2}'::jsonb, 1),
  ('steady-signal', '{"type":"distinct_months_with_validated_reports","threshold":3}'::jsonb, 1),
  ('season-hopper', '{"type":"distinct_seasons_with_validated_reports","threshold":2}'::jsonb, 1),
  ('on-the-podium', '{"type":"final_season_rank","period":"quarter","max_rank":3}'::jsonb, 1),
  ('quarter-champion', '{"type":"final_season_rank","period":"quarter","max_rank":1}'::jsonb, 1),
  ('year-champion', '{"type":"final_season_rank","period":"year","max_rank":1}'::jsonb, 1)
ON CONFLICT (id) DO UPDATE SET rule = excluded.rule, catalog_version = excluded.catalog_version;

SELECT app_achievement_refresh(NULL);
