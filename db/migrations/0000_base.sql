CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text UNIQUE,
  email_verified timestamptz,
  image text,
  platform_role text NOT NULL DEFAULT 'researcher' CHECK (platform_role IN ('admin', 'researcher')),
  pseudonym text,
  leaderboard_visible boolean NOT NULL DEFAULT false
);

CREATE TABLE accounts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE sessions (
  session_token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE org_memberships (
  org_id uuid NOT NULL REFERENCES org_units(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('admin', 'member', 'oversight')),
  PRIMARY KEY (org_id, user_id, role)
);
CREATE INDEX org_memberships_user ON org_memberships (user_id, org_id);

CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org_units(id),
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  rules text NOT NULL DEFAULT '',
  disclosure_policy text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  eligibility text NOT NULL DEFAULT 'organization' CHECK (eligibility IN ('all', 'organization', 'invitation')),
  leaderboard_visibility text NOT NULL DEFAULT 'members' CHECK (leaderboard_visibility IN ('members', 'hidden')),
  scoring jsonb NOT NULL DEFAULT '{"none":0,"low":50,"medium":200,"high":500,"critical":1000}'::jsonb,
  UNIQUE (org_id, slug)
);

CREATE TABLE program_memberships (
  program_id uuid NOT NULL REFERENCES programs(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('manager', 'triager', 'researcher')),
  PRIMARY KEY (program_id, user_id, role)
);
CREATE INDEX program_memberships_user ON program_memberships (user_id, program_id);

CREATE TABLE program_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  in_scope boolean NOT NULL DEFAULT true,
  UNIQUE (program_id, id)
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  program_id uuid NOT NULL REFERENCES programs(id),
  reporter_id uuid NOT NULL REFERENCES users(id),
  asset_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  cwe text NOT NULL,
  steps text NOT NULL,
  proof_of_concept text NOT NULL DEFAULT '',
  impact text NOT NULL,
  proposed_severity text NOT NULL CHECK (proposed_severity IN ('none', 'low', 'medium', 'high', 'critical')),
  severity text CHECK (severity IN ('none', 'low', 'medium', 'high', 'critical')),
  cvss_vector text,
  cvss_score real CHECK (cvss_score BETWEEN 0 AND 10),
  assignee_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'triage', 'validated', 'remediation', 'retesting', 'resolved',
    'needs_information', 'duplicate', 'informative', 'out_of_scope', 'not_applicable'
  )),
  duplicate_of_id uuid CHECK (duplicate_of_id <> id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, id),
  UNIQUE (program_id, id, reporter_id),
  FOREIGN KEY (program_id, asset_id) REFERENCES program_scopes(program_id, id),
  FOREIGN KEY (program_id, duplicate_of_id) REFERENCES reports(program_id, id),
  CHECK ((cvss_vector IS NULL) = (cvss_score IS NULL)),
  CHECK (status <> 'duplicate' OR duplicate_of_id IS NOT NULL)
);
CREATE INDEX reports_reporter ON reports (reporter_id, created_at DESC, id);
CREATE INDEX reports_inbox ON reports (program_id, status, created_at DESC, id);

CREATE TABLE report_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id),
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_comments_report ON report_comments (report_id, created_at, id);

CREATE TABLE report_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_events_report ON report_events (report_id, created_at, id);

CREATE TABLE report_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  storage_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  media_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_attachments_report ON report_attachments (report_id);

CREATE TABLE score_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  program_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('award', 'correction')),
  points integer NOT NULL CHECK (kind <> 'award' OR points >= 0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (program_id, report_id, user_id) REFERENCES reports(program_id, id, reporter_id)
);
CREATE UNIQUE INDEX score_award_per_report ON score_events (report_id) WHERE kind = 'award';
CREATE INDEX score_events_program ON score_events (program_id, created_at, user_id);
CREATE INDEX score_events_user ON score_events (user_id, created_at);

CREATE TABLE seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at),
  UNIQUE (starts_at, ends_at)
);

CREATE TABLE achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL,
  minimum_validated integer NOT NULL CHECK (minimum_validated > 0)
);

CREATE TABLE rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  minimum_points integer NOT NULL CHECK (minimum_points >= 0)
);

CREATE TABLE notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id),
  kind text NOT NULL CHECK (kind IN ('smtp', 'webhook')),
  destination text NOT NULL,
  signing_secret text,
  enabled boolean NOT NULL DEFAULT true,
  subscribed_events text[] NOT NULL DEFAULT '{}',
  severities text[] NOT NULL DEFAULT '{}',
  UNIQUE (program_id, id),
  CHECK (kind <> 'webhook' OR length(signing_secret) >= 32 AND signing_secret IS NOT NULL)
);

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  event_type text NOT NULL,
  report_id uuid,
  severity text,
  public_report_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND attempts),
  FOREIGN KEY (program_id, channel_id) REFERENCES notification_channels(program_id, id),
  FOREIGN KEY (program_id, report_id) REFERENCES reports(program_id, id)
);
CREATE INDEX notification_outbox_pending ON notification_outbox (available_at, id) WHERE status = 'pending';
CREATE INDEX notification_outbox_program ON notification_outbox (program_id, created_at DESC, id);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES notification_outbox(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, attempt)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES org_units(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org ON audit_events (org_id, created_at DESC, id);
