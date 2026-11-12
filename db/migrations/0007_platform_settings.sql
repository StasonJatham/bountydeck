CREATE TABLE platform_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  report_exports boolean NOT NULL DEFAULT true,
  global_leaderboard boolean NOT NULL DEFAULT true
);
INSERT INTO platform_settings DEFAULT VALUES;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_read ON platform_settings FOR SELECT TO bossob_app
  USING (app_actor() IS NOT NULL);
CREATE POLICY platform_settings_manage ON platform_settings FOR UPDATE TO bossob_app
  USING (app_platform_admin());
GRANT SELECT ON platform_settings TO bossob_app;
GRANT UPDATE (report_exports, global_leaderboard) ON platform_settings TO bossob_app;

ALTER FUNCTION app_leaderboard(text, uuid, text, bigint, uuid) RENAME TO app_leaderboard_rows;
REVOKE EXECUTE ON FUNCTION app_leaderboard_rows(text, uuid, text, bigint, uuid) FROM bossob_app;
CREATE FUNCTION app_leaderboard(
  scope text, target uuid, period text,
  after_points bigint DEFAULT NULL, after_user uuid DEFAULT NULL
) RETURNS TABLE (user_id uuid, label text, points bigint, standing bigint, is_self boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT rows.* FROM app_leaderboard_rows(scope, target, period, after_points, after_user) rows
  WHERE scope <> 'global' OR (SELECT global_leaderboard FROM platform_settings)
  ORDER BY rows.points DESC, rows.user_id
$$;
REVOKE EXECUTE ON FUNCTION app_leaderboard(text, uuid, text, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_leaderboard(text, uuid, text, bigint, uuid) TO bossob_app;
