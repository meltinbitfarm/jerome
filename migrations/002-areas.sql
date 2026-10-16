-- Schema v2 (D100): the area a heartbeat worked on, and the area a decision request holds up.
-- Null for interactive sessions, service runs, heartbeats stopped before the triage, and requests about the project.
ALTER TABLE runs ADD COLUMN area TEXT;
ALTER TABLE requests ADD COLUMN area TEXT;
