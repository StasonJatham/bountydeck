REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE FUNCTION app_actor() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT nullif(current_setting('app.actor_id', true), '')::uuid $$;

CREATE FUNCTION app_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (SELECT FROM users WHERE id = app_actor() AND platform_role = 'admin') $$;

CREATE FUNCTION app_org_admin(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (SELECT FROM org_memberships WHERE org_id = target AND user_id = app_actor() AND role = 'admin') $$;

CREATE FUNCTION app_manages_program(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT FROM programs WHERE id = target AND app_org_admin(org_id))
      OR EXISTS (SELECT FROM program_memberships WHERE program_id = target AND user_id = app_actor() AND role = 'manager')
$$;

CREATE FUNCTION app_reviews_program(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT app_manages_program(target)
      OR EXISTS (SELECT FROM program_memberships WHERE program_id = target AND user_id = app_actor() AND role = 'triager')
      OR EXISTS (
        SELECT FROM org_memberships m JOIN programs p ON p.org_id = m.org_id
        WHERE p.id = target AND m.user_id = app_actor() AND m.role = 'oversight'
      )
$$;

CREATE FUNCTION app_program_eligible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT app_actor() IS NOT NULL AND EXISTS (
    SELECT FROM programs p WHERE p.id = target AND (
      p.eligibility = 'all'
      OR EXISTS (SELECT FROM program_memberships WHERE program_id = target AND user_id = app_actor())
      OR (p.eligibility = 'organization' AND EXISTS (
        SELECT FROM org_memberships WHERE org_id = p.org_id AND user_id = app_actor()
      ))
    )
  )
$$;

CREATE FUNCTION app_can_submit(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT app_program_eligible(target) AND EXISTS (SELECT FROM programs WHERE id = target AND status = 'published') $$;

CREATE FUNCTION app_can_view_program(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT app_reviews_program(target) OR EXISTS (
    SELECT FROM programs p WHERE p.id = target AND (
      (p.status IN ('published', 'paused') AND app_program_eligible(target))
      OR EXISTS (SELECT FROM program_memberships WHERE program_id = target AND user_id = app_actor())
    )
  )
$$;

CREATE FUNCTION app_report_review(target uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (SELECT FROM reports WHERE id = target AND app_reviews_program(program_id)) $$;

REVOKE EXECUTE ON FUNCTION app_actor(), app_platform_admin(), app_org_admin(uuid),
  app_manages_program(uuid), app_reviews_program(uuid), app_program_eligible(uuid),
  app_can_submit(uuid), app_can_view_program(uuid), app_report_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_actor(), app_platform_admin(), app_org_admin(uuid),
  app_manages_program(uuid), app_reviews_program(uuid), app_program_eligible(uuid),
  app_can_submit(uuid), app_can_view_program(uuid), app_report_review(uuid) TO bossob_app;

ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_read ON org_units FOR SELECT TO bossob_app USING (app_actor() IS NOT NULL);
CREATE POLICY org_create ON org_units FOR INSERT TO bossob_app WITH CHECK (app_platform_admin());
CREATE POLICY org_edit ON org_units FOR UPDATE TO bossob_app USING (app_org_admin(id) OR app_platform_admin());

ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_memberships_read ON org_memberships FOR SELECT TO bossob_app USING (
  user_id = app_actor() OR app_org_admin(org_id) OR app_platform_admin()
);
CREATE POLICY org_memberships_insert ON org_memberships FOR INSERT TO bossob_app WITH CHECK (
  app_platform_admin() OR (app_org_admin(org_id) AND role <> 'oversight')
);
CREATE POLICY org_memberships_delete ON org_memberships FOR DELETE TO bossob_app USING (
  app_platform_admin() OR (app_org_admin(org_id) AND role <> 'oversight')
);

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY programs_read ON programs FOR SELECT TO bossob_app USING (
  app_can_view_program(id) OR app_org_admin(org_id) OR app_platform_admin()
  OR (app_actor() IS NOT NULL AND status IN ('published', 'paused'))
);
CREATE POLICY programs_create ON programs FOR INSERT TO bossob_app WITH CHECK (app_org_admin(org_id));
CREATE POLICY programs_edit ON programs FOR UPDATE TO bossob_app USING (app_manages_program(id));

ALTER TABLE program_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY program_memberships_read ON program_memberships FOR SELECT TO bossob_app USING (
  user_id = app_actor() OR app_reviews_program(program_id)
);
CREATE POLICY program_memberships_insert ON program_memberships FOR INSERT TO bossob_app WITH CHECK (
  (app_manages_program(program_id) AND role <> 'manager')
  OR EXISTS (SELECT FROM programs WHERE id = program_id AND app_org_admin(org_id))
  OR (role = 'researcher' AND user_id = app_actor() AND app_can_submit(program_id))
);
CREATE POLICY program_memberships_delete ON program_memberships FOR DELETE TO bossob_app USING (
  (app_manages_program(program_id) AND role <> 'manager')
  OR EXISTS (SELECT FROM programs WHERE id = program_id AND app_org_admin(org_id))
);

ALTER TABLE program_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY program_scopes_read ON program_scopes FOR SELECT TO bossob_app USING (app_can_view_program(program_id));
CREATE POLICY program_scopes_write ON program_scopes FOR ALL TO bossob_app USING (app_manages_program(program_id));

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
CREATE POLICY reports_read ON reports FOR SELECT USING (
  reporter_id = app_actor() OR app_reviews_program(program_id)
);
CREATE POLICY reports_submit ON reports FOR INSERT TO bossob_app WITH CHECK (
  reporter_id = app_actor() AND app_can_submit(program_id) AND status = 'submitted'
  AND severity IS NULL AND cvss_vector IS NULL AND assignee_id IS NULL AND duplicate_of_id IS NULL
  AND EXISTS (
    SELECT FROM program_scopes s WHERE s.program_id = reports.program_id AND s.id = reports.asset_id AND s.in_scope
  )
);
CREATE POLICY reports_review ON reports FOR UPDATE TO bossob_app USING (app_reviews_program(program_id));

ALTER TABLE report_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY comments_read ON report_comments FOR SELECT TO bossob_app USING (
  EXISTS (SELECT FROM reports WHERE id = report_id)
  AND (NOT internal OR app_report_review(report_id))
);
CREATE POLICY comments_write ON report_comments FOR INSERT TO bossob_app WITH CHECK (
  author_id = app_actor() AND EXISTS (SELECT FROM reports WHERE id = report_id)
  AND (NOT internal OR app_report_review(report_id))
);

ALTER TABLE report_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_events FORCE ROW LEVEL SECURITY;
CREATE POLICY report_events_read ON report_events FOR SELECT TO bossob_app USING (
  EXISTS (SELECT FROM reports WHERE id = report_id)
  AND (NOT internal OR app_report_review(report_id))
);
CREATE POLICY report_events_write ON report_events FOR INSERT TO bossob_app WITH CHECK (
  actor_id = app_actor() AND EXISTS (SELECT FROM reports WHERE id = report_id)
  AND (app_report_review(report_id) OR (NOT internal AND kind IN ('submitted', 'commented', 'attachment_uploaded')))
);

ALTER TABLE report_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY attachments_read ON report_attachments FOR SELECT TO bossob_app USING (
  EXISTS (SELECT FROM reports WHERE id = report_id)
);
CREATE POLICY attachments_write ON report_attachments FOR INSERT TO bossob_app WITH CHECK (
  uploaded_by = app_actor() AND EXISTS (SELECT FROM reports WHERE id = report_id)
);

ALTER TABLE score_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY scores_read ON score_events FOR SELECT TO bossob_app USING (
  user_id = app_actor() OR app_reviews_program(program_id)
);
CREATE POLICY scores_write ON score_events FOR INSERT TO bossob_app WITH CHECK (
  actor_id = app_actor() AND app_reviews_program(program_id)
  AND (kind = 'correction' OR EXISTS (SELECT FROM reports WHERE id = report_id AND status = 'validated'))
);

ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY rewards_read ON rewards FOR SELECT TO bossob_app USING (app_can_view_program(program_id));
CREATE POLICY rewards_write ON rewards FOR ALL TO bossob_app USING (app_manages_program(program_id));

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_channels_manage ON notification_channels FOR ALL TO bossob_app USING (app_manages_program(program_id));
CREATE POLICY notification_channels_worker ON notification_channels FOR SELECT TO bossob_worker USING (true);

ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_outbox_read ON notification_outbox FOR SELECT TO bossob_app USING (app_manages_program(program_id));
CREATE POLICY notification_outbox_worker ON notification_outbox FOR ALL TO bossob_worker USING (true);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_deliveries_read ON notification_deliveries FOR SELECT TO bossob_app USING (
  EXISTS (SELECT FROM notification_outbox WHERE id = outbox_id)
);
CREATE POLICY notification_deliveries_worker ON notification_deliveries FOR ALL TO bossob_worker USING (true);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_events FOR SELECT TO bossob_app USING (
  app_platform_admin() OR app_org_admin(org_id)
);
CREATE POLICY audit_write ON audit_events FOR INSERT TO bossob_app WITH CHECK (
  actor_id = app_actor() AND (org_id IS NULL OR app_org_admin(org_id) OR app_platform_admin())
);

GRANT USAGE ON SCHEMA public TO bossob_app, bossob_worker;
GRANT SELECT ON users, accounts, sessions TO bossob_app;
GRANT INSERT (id, name, email, email_verified, image) ON users TO bossob_app;
GRANT UPDATE (name, email, email_verified, image, pseudonym, leaderboard_visible) ON users TO bossob_app;
GRANT INSERT, UPDATE, DELETE ON accounts, sessions TO bossob_app;
GRANT SELECT, INSERT ON org_units, org_memberships, programs, program_memberships,
  program_scopes, reports, report_comments, report_events, report_attachments, score_events,
  rewards, notification_channels, audit_events TO bossob_app;
GRANT SELECT ON seasons, achievements, notification_outbox, notification_deliveries TO bossob_app;
GRANT UPDATE (name, slug, description) ON org_units TO bossob_app;
GRANT UPDATE (name, slug, description, rules, disclosure_policy, status, eligibility, leaderboard_visibility, scoring) ON programs TO bossob_app;
GRANT UPDATE (name, description, in_scope) ON program_scopes TO bossob_app;
GRANT UPDATE (severity, cvss_vector, cvss_score, assignee_id, status, duplicate_of_id, updated_at) ON reports TO bossob_app;
GRANT UPDATE (name, description, minimum_points) ON rewards TO bossob_app;
GRANT UPDATE (kind, destination, signing_secret, enabled, subscribed_events, severities) ON notification_channels TO bossob_app;
GRANT DELETE ON org_memberships, program_memberships, program_scopes, rewards TO bossob_app;

GRANT SELECT ON notification_channels, notification_outbox TO bossob_worker;
GRANT UPDATE (available_at, status, attempts, retry_count) ON notification_outbox TO bossob_worker;
GRANT INSERT ON notification_deliveries TO bossob_worker;
