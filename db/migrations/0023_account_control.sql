ALTER TABLE users ADD COLUMN login_disabled boolean NOT NULL DEFAULT false;
GRANT UPDATE (login_disabled) ON users TO bossob_app;
-- Only the platform administrator may disable login on a non-administrator.
CREATE FUNCTION guard_login_disabled() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.login_disabled IS DISTINCT FROM OLD.login_disabled AND
    (OLD.platform_role = 'admin' OR NOT app_platform_admin()) THEN
    RAISE EXCEPTION 'Account access change forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER guard_login_disabled BEFORE UPDATE OF login_disabled ON users
  FOR EACH ROW EXECUTE FUNCTION guard_login_disabled();

CREATE OR REPLACE FUNCTION app_personal_key(candidate text) RETURNS TABLE(actor_id uuid, key_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT k.user_id, k.id FROM public.personal_api_keys k JOIN public.users u ON u.id = k.user_id
  WHERE k.digest = candidate AND k.expires_at > now() AND NOT u.login_disabled
$$;
