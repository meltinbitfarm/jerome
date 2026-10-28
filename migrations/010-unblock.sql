-- Schema v10 (D167): who closed an alert from afar, and how: 'telegram:commit', 'director:retry'.
ALTER TABLE alerts ADD COLUMN resolved_by TEXT;
