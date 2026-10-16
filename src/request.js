// `jerome request`: decision requests (D56, D74). In a heartbeat nobody reads the reply, so the lead agent opens a
// request instead of asking, and stops that line of work; in a session it proposes the open ones to the user and
// records the answer. The CLI writes, the model only passes the text.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MARKER } from './template.js';
import { openDb } from './db.js';
import { notProjectMessage } from './paths.js';
import { readAreas } from './areas.js';

export async function request(action, args, { dir: dirArg = '.', question, options, recommendation, area = null, env = process.env } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(notProjectMessage(dir));
    return 1;
  }
  const db = openDb(dir);
  if (!db) {
    console.error(`The project database is missing: run \`jerome doctor\` to create it.`);
    return 1;
  }
  try {
    if (action === 'open') {
      if (!question) {
        console.error('jerome request open needs --question.');
        return 2;
      }
      if (area !== null) {
        const known = readAreas(dir).areas.map((a) => a.name);
        if (!known.includes(area)) {
          console.error(`There is no area ${area}; the areas are ${known.join(', ')}.`);
          return 2;
        }
      }
      const id = openRequest(db, { question, options, recommendation, area, sessionId: env.JEROME_SESSION_ID ?? null });
      console.log(`R${id} opened. Stop this line of work until the user answers.`);
      return 0;
    }
    const id = Number(String(args[0] ?? '').replace(/^R/i, ''));
    const row = Number.isInteger(id) ? db.prepare('SELECT status FROM requests WHERE id = ?').get(id) : null;
    if (!row) {
      console.error(`There is no decision request ${args[0] ?? ''}.`);
      return 1;
    }
    if (row.status !== 'open') {
      console.error(`R${id} is already ${row.status}.`);
      return 1;
    }
    if (action === 'answer') {
      const answer = args.slice(1).join(' ').trim();
      if (!answer) {
        console.error('jerome request answer needs the answer after the id.');
        return 2;
      }
      db.prepare("UPDATE requests SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?").run(answer, new Date().toISOString(), id);
      console.log(`R${id} answered. If the answer is a decision, record it in decisions.md.`);
      return 0;
    }
    db.prepare("UPDATE requests SET status = 'dropped', answered_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    console.log(`R${id} dropped.`);
    return 0;
  } finally {
    db.close();
  }
}

// Opens a request, linked to the run of the session that asked for it when known, and returns its id. Its area
// (D100) is the one given, or that of the heartbeat that opened it: while it is open, that area gets no work.
// The same question already open is not opened twice.
export function openRequest(db, { question, options = null, recommendation = null, area = null, sessionId = null, runId = null }) {
  const open = db.prepare("SELECT id FROM requests WHERE status = 'open' AND question = ?").get(question);
  if (open) return open.id;
  const run = runId !== null
    ? db.prepare('SELECT id, area FROM runs WHERE id = ?').get(runId)
    : sessionId ? db.prepare('SELECT id, area FROM runs WHERE session_id = ?').get(sessionId) : null;
  return Number(db.prepare('INSERT INTO requests (run_id, opened_at, question, options, recommendation, area) VALUES (?, ?, ?, ?, ?, ?)')
    .run(run?.id ?? runId, new Date().toISOString(), question, options, recommendation, area ?? run?.area ?? null).lastInsertRowid);
}
