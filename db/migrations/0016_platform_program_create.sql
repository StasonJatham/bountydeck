DROP POLICY programs_create ON programs;
CREATE POLICY programs_create ON programs FOR INSERT TO bossob_app
  WITH CHECK (app_platform_admin());
