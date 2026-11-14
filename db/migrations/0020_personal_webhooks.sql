ALTER TABLE notification_channels
  ALTER COLUMN program_id DROP NOT NULL,
  ADD COLUMN owner_id uuid REFERENCES users(id),
  ADD CONSTRAINT notification_channel_scope CHECK ((program_id IS NULL) <> (owner_id IS NULL)),
  ADD CONSTRAINT personal_webhook_only CHECK (owner_id IS NULL OR kind = 'webhook'),
  ADD UNIQUE (owner_id);

ALTER TABLE notification_outbox ADD COLUMN personal boolean NOT NULL DEFAULT false,
  ADD COLUMN channel_program_id uuid GENERATED ALWAYS AS (CASE WHEN personal THEN NULL ELSE program_id END) STORED,
  DROP CONSTRAINT notification_outbox_program_id_channel_id_fkey,
  ADD FOREIGN KEY (channel_id) REFERENCES notification_channels(id),
  ADD FOREIGN KEY (channel_program_id, channel_id) REFERENCES notification_channels(program_id, id);
DROP POLICY notification_outbox_read ON notification_outbox;
CREATE POLICY notification_outbox_read ON notification_outbox FOR SELECT TO bossob_app USING (
  EXISTS (SELECT FROM notification_channels c WHERE c.id = channel_id)
);
CREATE POLICY personal_channel ON notification_channels TO bossob_app
  USING (owner_id = app_actor()) WITH CHECK (owner_id = app_actor());
GRANT INSERT (owner_id) ON notification_channels TO bossob_app;

CREATE FUNCTION personal_notification_visible(owner uuid, program uuid, report uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET app.actor_id = '' AS $$
BEGIN
  PERFORM set_config('app.actor_id', owner::text, true);
  IF report IS NOT NULL THEN
    RETURN EXISTS (SELECT FROM reports WHERE id = report AND reporter_id = owner);
  END IF;
  RETURN EXISTS (
    SELECT FROM programs WHERE id = program AND status = 'published'
      AND app_can_view_program(id)
  );
END;
$$;
REVOKE ALL ON FUNCTION personal_notification_visible(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_notification_visible(uuid,uuid,uuid) TO bossob_worker;

CREATE FUNCTION enqueue_personal_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  item reports%ROWTYPE;
  event text;
BEGIN
  IF TG_TABLE_NAME = 'programs' THEN
    IF NEW.status <> 'published' OR NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
    event := CASE WHEN OLD.status = 'published' THEN 'program.updated' ELSE 'program.published' END;
    INSERT INTO notification_outbox (program_id, channel_id, event_type, routing_revision, personal)
    SELECT NEW.id, id, event, routing_revision, true FROM notification_channels
    WHERE owner_id IS NOT NULL AND enabled AND event = ANY(subscribed_events)
      AND personal_notification_visible(owner_id, NEW.id, NULL);
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'report_comments' THEN
    IF NEW.internal THEN RETURN NULL; END IF;
    SELECT * INTO item FROM reports WHERE id = NEW.report_id;
    event := 'report.comment_added';
  ELSE
    item := NEW;
    IF TG_OP = 'INSERT' THEN
      event := 'report.submitted';
    ELSIF ROW(NEW.status, NEW.severity, NEW.assignee_id) IS DISTINCT FROM ROW(OLD.status, OLD.severity, OLD.assignee_id) THEN
      event := 'report.updated';
    END IF;
  END IF;
  IF event IS NULL THEN RETURN NULL; END IF;
  INSERT INTO notification_outbox (program_id, channel_id, event_type, report_id, severity, public_report_id, routing_revision, personal)
  SELECT item.program_id, id, event, item.id, item.severity, 'BSO-' || item.number, routing_revision, true
  FROM notification_channels WHERE owner_id = item.reporter_id AND enabled AND event = ANY(subscribed_events);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION enqueue_personal_notification() FROM PUBLIC;
CREATE TRIGGER personal_program_notifications AFTER INSERT OR UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION enqueue_personal_notification();
CREATE TRIGGER personal_report_notifications AFTER INSERT OR UPDATE OF status, severity, assignee_id ON reports
  FOR EACH ROW EXECUTE FUNCTION enqueue_personal_notification();
CREATE TRIGGER personal_comment_notifications AFTER INSERT ON report_comments
  FOR EACH ROW EXECUTE FUNCTION enqueue_personal_notification();
