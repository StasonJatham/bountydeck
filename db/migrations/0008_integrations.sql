CREATE TABLE integration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id),
  actor_type text NOT NULL CHECK (actor_type IN ('delegated', 'service')),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 255),
  operation text NOT NULL,
  resource_id text,
  request_id uuid NOT NULL,
  outcome integer NOT NULL CHECK (outcome BETWEEN 100 AND 599),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_audit_actor_date ON integration_audit(actor_id, created_at DESC);
ALTER TABLE integration_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_audit_read ON integration_audit FOR SELECT TO bossob_app
  USING (actor_id = app_actor() OR app_platform_admin());
CREATE POLICY integration_audit_write ON integration_audit FOR INSERT TO bossob_app
  WITH CHECK (actor_id = app_actor());
GRANT SELECT, INSERT ON integration_audit TO bossob_app;

CREATE TABLE integration_request_windows (
  actor_id uuid PRIMARY KEY REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests > 0)
);
ALTER TABLE integration_request_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_windows_actor ON integration_request_windows TO bossob_app
  USING (actor_id = app_actor());
GRANT SELECT, INSERT, UPDATE ON integration_request_windows TO bossob_app;

CREATE TABLE integration_idempotency (
  actor_id uuid NOT NULL REFERENCES users(id),
  client_id text NOT NULL,
  request_key text NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, client_id, request_key)
);
ALTER TABLE integration_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_idempotency_actor ON integration_idempotency TO bossob_app
  USING (actor_id = app_actor());
GRANT SELECT, INSERT, DELETE ON integration_idempotency TO bossob_app;
