-- Schema v12 (D216): a note the user marks urgent, by the button under it on Telegram, "!" before its text, the
-- dashboard's box or `jerome note add --urgent`, starts a run as soon as it can and comes before any other work.
-- urgent_at is when it became urgent; order_id the Director's order that brought it, which its button names.
ALTER TABLE notes ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN urgent_at TEXT;
ALTER TABLE notes ADD COLUMN order_id INTEGER;
