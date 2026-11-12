-- Global ranks exclude restricted programs. Organization and program ranks
-- include only programs the viewer can participate in or review.
CREATE FUNCTION app_leaderboard(
  scope text, target uuid, period text,
  after_points bigint DEFAULT NULL, after_user uuid DEFAULT NULL
) RETURNS TABLE (user_id uuid, label text, points bigint, standing bigint, is_self boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH bounds AS (
    SELECT CASE period
      WHEN 'quarter' THEN date_trunc('quarter', now(), 'UTC')
      WHEN 'year' THEN date_trunc('year', now(), 'UTC')
      WHEN 'all' THEN '-infinity'::timestamptz
      ELSE 'infinity'::timestamptz
    END AS starts_at
  ), totals AS (
    SELECT score.user_id,
      coalesce(nullif(u.pseudonym, ''), nullif(u.name, ''), 'Researcher') AS label,
      sum(score.points) AS points
    FROM score_events score
    JOIN users u ON u.id = score.user_id
    JOIN programs p ON p.id = score.program_id
    CROSS JOIN bounds
    WHERE app_actor() IS NOT NULL
      AND (u.leaderboard_visible OR u.id = app_actor())
      AND score.created_at >= bounds.starts_at
      AND p.leaderboard_visibility <> 'hidden'
      AND CASE scope
        WHEN 'global' THEN p.eligibility = 'all' AND p.status IN ('published', 'paused')
        WHEN 'organization' THEN p.org_id = target AND app_can_view_program(p.id)
        WHEN 'program' THEN p.id = target AND app_can_view_program(p.id)
        ELSE false
      END
    GROUP BY score.user_id, u.pseudonym, u.name
  ), ranked AS (
    SELECT totals.*, rank() OVER (ORDER BY totals.points DESC) AS standing
    FROM totals
  )
  SELECT ranked.user_id, ranked.label, ranked.points, ranked.standing, ranked.user_id = app_actor()
  FROM ranked
  WHERE after_points IS NULL OR ranked.points < after_points
    OR (ranked.points = after_points AND ranked.user_id > after_user)
  ORDER BY ranked.points DESC, ranked.user_id
  LIMIT 101
$$;

REVOKE EXECUTE ON FUNCTION app_leaderboard(text, uuid, text, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_leaderboard(text, uuid, text, bigint, uuid) TO bossob_app;

INSERT INTO achievements (name, description, minimum_validated) VALUES
  ('First validated finding', 'One report earned a validation award.', 1),
  ('Five validated findings', 'Five reports earned validation awards.', 5),
  ('Ten validated findings', 'Ten reports earned validation awards.', 10);
