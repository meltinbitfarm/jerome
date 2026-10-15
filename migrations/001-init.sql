-- Schema v1 of the project database (D51, D53): only what phases 6-9 need.
-- Allowed values are CHECK constraints, not reference tables; model prices live in src/models.js.

-- One row per session or run: the log line of D13. session_id is null for a heartbeat that never started.
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  session_id TEXT UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('interactive', 'heartbeat', 'service')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'blocked', 'stopped')),
  reason TEXT
);
CREATE INDEX runs_started_at ON runs (started_at);

-- One row per API call, read from the transcripts and deduplicated by request_id (D20).
CREATE TABLE usage (
  request_id TEXT PRIMARY KEY,
  run_id INTEGER REFERENCES runs (id),
  agent TEXT NOT NULL,
  agent_id TEXT,
  model TEXT NOT NULL,
  input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write_5m INTEGER NOT NULL DEFAULT 0,
  cache_write_1h INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
CREATE INDEX usage_at ON usage (at);

-- Usage rows older than the retention period, summed per day, agent and model (D55).
CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  requests INTEGER NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write_5m INTEGER NOT NULL,
  cache_write_1h INTEGER NOT NULL,
  PRIMARY KEY (day, agent, model)
);

-- How far each transcript has been read, so each hook reads only the new lines.
CREATE TABLE transcript_reads (
  path TEXT PRIMARY KEY,
  offset INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- Hook events. data holds numbers and names only, never message contents.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES runs (id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('session-start', 'stop', 'subagent-stop', 'session-end', 'blocked', 'error')),
  agent TEXT,
  data TEXT
);
CREATE INDEX events_at ON events (at);

-- Decision requests (phase 8), opened and closed through `jerome request` (D56).
CREATE TABLE requests (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES runs (id),
  opened_at TEXT NOT NULL,
  question TEXT NOT NULL,
  options TEXT,
  recommendation TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dropped')),
  answer TEXT,
  answered_at TEXT
);
