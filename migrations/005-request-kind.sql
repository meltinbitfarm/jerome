-- Schema v5 (D117): what a decision request holds up. A milestone request (the check of D96) holds up its whole area;
-- a question only the work that depends on it. Requests already open with an area held their area up, and keep doing so.
ALTER TABLE requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'question';
UPDATE requests SET kind = 'milestone' WHERE status = 'open' AND area IS NOT NULL;
