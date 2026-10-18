-- Schema v4 (D115): the caps a heartbeat ran with, as JSON: maxTokens, maxTurns, and once when they were given for
-- that run only (D108). Null for other runs and for heartbeats from before.
ALTER TABLE runs ADD COLUMN caps TEXT;
