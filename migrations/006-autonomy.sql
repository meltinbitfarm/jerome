-- Schema v6 (D118-D123): what a heartbeat run was and how it ended. mode is 'normal' or 'resume' (D119); slot the
-- slot that started it (D118); exit_code the lead agent's; outcome the end-of-run check as JSON { ok, failures } (D120).
ALTER TABLE runs ADD COLUMN mode TEXT;
ALTER TABLE runs ADD COLUMN slot TEXT;
ALTER TABLE runs ADD COLUMN exit_code INTEGER;
ALTER TABLE runs ADD COLUMN outcome TEXT;

-- Alerts (D121): something wrong with the autonomous runs themselves, not a decision. One open alert per key; a
-- repeat bumps its count. They close by themselves when a heartbeat ends well.
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES runs (id),
  key TEXT NOT NULL,
  reason TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at TEXT
);
CREATE INDEX alerts_status ON alerts (status);
