-- Schema v9 (D141, D142): fill runs, started by the quota governor when the subscription's week is behind its pace,
-- and the quota each run of the lead agent took: the windows read before and after it, with its model, so what a
-- run costs in percentage points can be learnt.
ALTER TABLE runs ADD COLUMN fill INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN quota TEXT;
