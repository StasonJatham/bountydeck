CREATE TABLE profile_avatars (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 1048576),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profile_avatars ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile_avatar ON profile_avatars TO bossob_app
  USING (user_id = app_actor())
  WITH CHECK (user_id = app_actor());
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_avatars TO bossob_app;
