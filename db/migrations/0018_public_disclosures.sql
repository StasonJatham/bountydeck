CREATE TABLE public_disclosures (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('program','report')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 12000)
);
ALTER TABLE public_disclosures ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_disclosure_read ON public_disclosures FOR SELECT TO bossob_app USING (true);
CREATE POLICY public_disclosure_admin ON public_disclosures TO bossob_app
  USING (app_platform_admin()) WITH CHECK (app_platform_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public_disclosures TO bossob_app;
