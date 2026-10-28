-- Schema v7 (D136): the processes behind a run, so a run whose process is gone can be closed. pid is the heartbeat
-- runner's, or the Claude Code process of an interactive session; lead_pid the heartbeat's lead agent, the leader of
-- its own process group. Each with its start time as ps prints it, so a pid used again by another process is not
-- taken for it.
ALTER TABLE runs ADD COLUMN pid INTEGER;
ALTER TABLE runs ADD COLUMN pid_started TEXT;
ALTER TABLE runs ADD COLUMN lead_pid INTEGER;
ALTER TABLE runs ADD COLUMN lead_started TEXT;
