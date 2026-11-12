ALTER TABLE notification_channels ADD COLUMN routing_revision integer NOT NULL DEFAULT 0;
ALTER TABLE notification_outbox ADD COLUMN routing_revision integer NOT NULL DEFAULT 0;

CREATE FUNCTION public.notification_route_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.kind, NEW.destination, NEW.signing_secret, NEW.enabled) IS DISTINCT FROM
     ROW(OLD.kind, OLD.destination, OLD.signing_secret, OLD.enabled) THEN
    NEW.routing_revision := OLD.routing_revision + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notification_route_changed() FROM PUBLIC;
CREATE TRIGGER notification_route_changed
BEFORE UPDATE ON public.notification_channels FOR EACH ROW EXECUTE FUNCTION public.notification_route_changed();

CREATE FUNCTION public.enqueue_report_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  report public.reports%ROWTYPE;
  events text[] := '{}';
BEGIN
  IF TG_TABLE_NAME = 'report_comments' THEN
    IF NEW.internal THEN RETURN NULL; END IF;
    SELECT * INTO report FROM public.reports WHERE id = NEW.report_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    events := ARRAY['report.comment_added'];
  ELSE
    report := NEW;
    IF TG_OP = 'INSERT' THEN
      events := ARRAY['report.submitted'];
    ELSE
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        events := array_append(events, 'report.status_changed');
        IF NEW.status = 'validated' THEN events := array_append(events, 'report.validated'); END IF;
        IF NEW.status = 'resolved' THEN events := array_append(events, 'report.resolved'); END IF;
      END IF;
      IF NEW.severity IS DISTINCT FROM OLD.severity THEN events := array_append(events, 'report.severity_changed'); END IF;
      IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN events := array_append(events, 'report.assigned'); END IF;
    END IF;
  END IF;

  INSERT INTO public.notification_outbox (
    program_id, channel_id, event_type, report_id, severity, public_report_id, routing_revision
  )
  SELECT report.program_id, channel.id, event.kind, report.id, report.severity,
         'BSO-' || report.number, channel.routing_revision
  FROM public.notification_channels channel
  CROSS JOIN unnest(events) AS event(kind)
  WHERE channel.program_id = report.program_id AND channel.enabled
    AND event.kind = ANY(channel.subscribed_events)
    AND (cardinality(channel.severities) = 0 OR coalesce(report.severity, 'pending') = ANY(channel.severities));

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_report_notifications() FROM PUBLIC;

CREATE TRIGGER report_notifications
AFTER INSERT OR UPDATE OF status, severity, assignee_id ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.enqueue_report_notifications();
CREATE TRIGGER report_comment_notifications
AFTER INSERT ON public.report_comments
FOR EACH ROW EXECUTE FUNCTION public.enqueue_report_notifications();

CREATE FUNCTION public.test_notification(target uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  program uuid;
BEGIN
  INSERT INTO public.notification_outbox (program_id, channel_id, event_type, routing_revision)
  SELECT channel.program_id, channel.id, 'notification.test', channel.routing_revision
  FROM public.notification_channels channel
  WHERE channel.id = target AND channel.enabled AND public.app_manages_program(channel.program_id)
  RETURNING program_id INTO program;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.audit_events (org_id, actor_id, kind, details)
  SELECT org_id, public.app_actor(), 'notification.test', jsonb_build_object('channel_id', target)
  FROM public.programs WHERE id = program;
  RETURN true;
END;
$$;

CREATE FUNCTION public.retry_notification(target uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  program uuid;
BEGIN
  UPDATE public.notification_outbox queued
  SET status = 'pending', available_at = clock_timestamp(), retry_count = 0
  FROM public.notification_channels channel
  WHERE queued.id = target AND queued.status = 'dead' AND channel.id = queued.channel_id
    AND channel.enabled AND channel.routing_revision = queued.routing_revision
    AND public.app_manages_program(queued.program_id)
  RETURNING queued.program_id INTO program;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.audit_events (org_id, actor_id, kind, details)
  SELECT org_id, public.app_actor(), 'notification.retry', jsonb_build_object('outbox_id', target)
  FROM public.programs WHERE id = program;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.test_notification(uuid), public.retry_notification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_notification(uuid), public.retry_notification(uuid) TO bossob_app;
