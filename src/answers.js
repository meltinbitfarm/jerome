// The user's answers not recorded yet (D192): a question of open.md marked `(asked: R<n>)` whose request is no longer
// open. The lead agent records each answer as a decision and removes the question; until then the board leaves the
// question out, since it no longer waits for the user.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.js';
import { STATE } from './paths.js';

// The ids of open.md's `(asked: R<n>)` marks.
export function askedMarks(dir) {
  const file = join(dir, STATE.open);
  if (!existsSync(file)) return [];
  return [...new Set([...readFileSync(file, 'utf8').matchAll(/\(asked: R(\d+)\)/g)].map((m) => Number(m[1])))];
}

// The requests behind those marks that were answered or dropped: { id, status, question, answer }, by id.
export function answersToRecord(dir) {
  const ids = askedMarks(dir);
  if (!ids.length) return [];
  const db = openDb(dir, { readOnly: true, migrate: false });
  if (!db) return [];
  try {
    return db.prepare(`SELECT id, status, question, answer FROM requests WHERE status != 'open' AND id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`).all(...ids)
      .map((r) => ({ id: r.id, status: r.status, question: r.question, answer: r.answer ?? null }));
  } finally {
    db.close();
  }
}
