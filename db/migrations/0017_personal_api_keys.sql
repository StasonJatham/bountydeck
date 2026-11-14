CREATE TABLE personal_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  digest text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);
ALTER TABLE personal_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_api_keys ON personal_api_keys TO bossob_app
  USING (user_id = app_actor()) WITH CHECK (user_id = app_actor());
GRANT SELECT (id,user_id,name,expires_at), INSERT, DELETE ON personal_api_keys TO bossob_app;
CREATE FUNCTION app_personal_key(candidate text) RETURNS TABLE(actor_id uuid, key_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT user_id, id FROM public.personal_api_keys
  WHERE digest = candidate AND expires_at > now()
$$;
REVOKE ALL ON FUNCTION app_personal_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_personal_key(text) TO bossob_app;
