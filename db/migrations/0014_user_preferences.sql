CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locale text CHECK (locale IN ('en', 'de')),
  theme text CHECK (theme IN ('light', 'dark'))
);
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_preferences ON user_preferences TO bossob_app
  USING (user_id = app_actor()) WITH CHECK (user_id = app_actor());
GRANT SELECT, INSERT, UPDATE ON user_preferences TO bossob_app;
