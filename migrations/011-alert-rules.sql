-- Schema v11 (D172): the rules a run was refused, in full, on its alert, so a button can allow them for the project.
ALTER TABLE alerts ADD COLUMN rules TEXT;
