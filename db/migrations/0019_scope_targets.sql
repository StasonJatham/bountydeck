ALTER TABLE program_scopes
  ADD COLUMN target_type text NOT NULL DEFAULT 'other'
    CHECK (target_type IN ('host', 'ip', 'cidr', 'url', 'other')),
  ADD COLUMN target text NOT NULL DEFAULT '' CHECK (length(target) <= 512);
