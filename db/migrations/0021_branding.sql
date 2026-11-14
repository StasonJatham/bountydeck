CREATE TABLE branding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  name text NOT NULL DEFAULT 'BountyDeck' CHECK (length(name) BETWEEN 1 AND 70),
  accent text CHECK (accent ~ '^#[0-9a-f]{6}$'),
  logo bytea CHECK (octet_length(logo) BETWEEN 1 AND 1048576)
);
INSERT INTO branding DEFAULT VALUES;
ALTER TABLE branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY branding_read ON branding FOR SELECT TO bossob_app USING (true);
CREATE POLICY branding_edit ON branding FOR UPDATE TO bossob_app
  USING (app_platform_admin()) WITH CHECK (app_platform_admin());
GRANT SELECT, UPDATE (name, accent, logo) ON branding TO bossob_app;
