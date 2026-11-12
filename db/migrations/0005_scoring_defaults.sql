ALTER TABLE programs ALTER COLUMN scoring
  SET DEFAULT '{"none":0,"low":50,"medium":200,"high":500,"critical":1000}'::jsonb;

ALTER TABLE score_events ADD CONSTRAINT score_correction_requires_reason
  CHECK (kind <> 'correction' OR (points <> 0 AND length(btrim(reason)) BETWEEN 1 AND 500))
  NOT VALID;
