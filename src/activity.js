// An interactive session the user is working in (D187): one still open whose transcript, or failing that whose
// usage, moved in the last ACTIVE_MINUTES. Not just open: a session left open and forgotten held every heartbeat
// back for hours (D73, D122). While one is in use, no heartbeat starts in the project, and a slot's run waits.
import { statSync } from 'node:fs';
import { openDb } from './db.js';
import { findTranscript } from './delegations.js';

export const ACTIVE_MINUTES = 20;

// The session in use, as { sessionId, at }, or null.
export function activeSession(dir, { now = new Date(), find = findTranscript } = {}) {
  const db = openDb(dir, { readOnly: true, migrate: false });
  if (!db) return null;
  try {
    const since = now.getTime() - ACTIVE_MINUTES * 60_000;
    const rows = db.prepare(`SELECT r.session_id, r.started_at, (SELECT max(u.at) FROM usage u WHERE u.run_id = r.id) used
      FROM runs r WHERE r.kind = 'interactive' AND r.status = 'running'`).all();
    for (const r of rows) {
      let moved = null;
      try {
        const path = find(r.session_id);
        if (path) moved = statSync(path).mtime.toISOString();
      } catch {
        // No transcript to read: the usage says it.
      }
      const at = [moved, r.used, r.started_at].filter(Boolean).sort().at(-1);
      if (Date.parse(at) >= since) return { sessionId: r.session_id, at };
    }
    return null;
  } finally {
    db.close();
  }
}
