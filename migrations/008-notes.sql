-- Schema v8 (D133): notes from the user to a project, sent from Telegram (D132). Kept here, never in a tracked file,
-- so they never leave the working tree dirty under a heartbeat. The triage, the lead agent and the next session read
-- the open ones; the lead agent closes a note once it has recorded what it means in open.md or decisions.md.
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'telegram',
  received_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_at TEXT
);
CREATE INDEX notes_status ON notes (status);
