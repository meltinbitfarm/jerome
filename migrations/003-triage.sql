-- Schema v3 (D110): the triage's whole verdict, as JSON, kept with its run: area, task, reason, whether there was
-- work and whether it was a milestone check. Null for runs without a triage.
ALTER TABLE runs ADD COLUMN triage TEXT;
