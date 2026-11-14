CREATE OR REPLACE FUNCTION app_org_admin(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT FROM org_memberships
    WHERE org_id = target AND user_id = app_actor() AND role = 'admin'
  ) OR (
    app_platform_admin() AND EXISTS (SELECT FROM org_units WHERE id = target)
  )
$$;
