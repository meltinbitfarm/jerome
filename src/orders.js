// The orders of the Director's dashboard (D169, D191), as a Mac takes them from the answer to its beat: an answer to
// an open decision request, a note for a project, or one of the actions a block offers. They are data, never a
// command: each is checked here again, against this Mac's own projects and rules, and run by the same code as a tap
// or a reply on Telegram. Each one the Mac runs is told to the user on Telegram, so an order they did not send is seen
// at once (D191).
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { openDb } from './db.js';
import { stores } from './store.js';
import { addNote } from './notes.js';
import { ACTIONS, runAction } from './unblock.js';
import { enqueue } from './telegram.js';
import { scrub } from './scrub.js';
import { t, lang } from './i18n.js';

const BIN = join(import.meta.dirname, '..', 'bin', 'jerome.js');
// Older than this, an order is not run: the user tapped it too long ago (D169).
export const ORDER_MAX_MS = 10 * 60_000;
const TEXT_MAX = 2000;

// Runs the orders not run yet, and returns their results, { id, ok, text }. `done` holds the ids already run, with
// their result, so an order given again, because its result did not reach the Director, is reported, not run twice.
export function runOrders(orders, { done = {}, env = process.env, now = new Date() } = {}) {
  const code = lang(env);
  const say = (key, values) => t(key, values, code);
  const results = [];
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!Number.isInteger(o?.id)) continue;
    if (done[o.id]) {
      results.push({ id: o.id, ok: done[o.id].ok, text: done[o.id].text });
      continue;
    }
    const r = runOne(o, { env, now, say });
    const result = { id: o.id, ok: r.ok, text: scrub(r.text).slice(0, 300) };
    done[o.id] = { ok: result.ok, text: result.text, at: now.toISOString() };
    results.push(result);
    if (r.echo) enqueue({ dir: r.dir, text: r.echo, now });
  }
  return results;
}

function runOne(o, { env, now, say }) {
  const at = Date.parse(o.at);
  if (!Number.isFinite(at) || now.getTime() - at > ORDER_MAX_MS) return { ok: false, text: say('order.lapsed') };
  const store = stores().find((s) => !s.orphan && s.record?.path && s.key === o.project);
  if (!store) return { ok: false, text: say('order.noProject') };
  const dir = store.record.path;
  const project = basename(dir);
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (o.kind === 'answer') {
    if (!Number.isInteger(o.ref) || !text || text.length > TEXT_MAX) return { ok: false, text: say('order.bad') };
    const db = openDb(dir);
    const row = db?.prepare('SELECT status FROM requests WHERE id = ?').get(o.ref);
    db?.close();
    if (!row) return { ok: false, text: say('request.gone', { project, id: o.ref }) };
    if (row.status !== 'open') return { ok: false, text: say('request.closed', { project, id: o.ref, status: row.status }) };
    // The same write as `jerome request answer` in a session, without a shell.
    const r = spawnSync(process.execPath, [BIN, 'request', 'answer', String(o.ref), '--', text], { cwd: dir, env, encoding: 'utf8', timeout: 30_000 });
    if (r.status !== 0) return { ok: false, text: say('request.failed', { project, id: o.ref, error: (r.stderr || r.stdout).trim() }) };
    return { ok: true, dir, text: say('request.answered', { project, id: o.ref, text }), echo: say('order.echoAnswer', { id: o.ref, text }) };
  }
  if (o.kind === 'note') {
    if (!text || text.length > TEXT_MAX) return { ok: false, text: say('order.bad') };
    const db = openDb(dir);
    if (!db) return { ok: false, text: say('note.nodb', { project }) };
    let id;
    try {
      id = addNote(db, text, { source: 'director', now });
    } finally {
      db.close();
    }
    return { ok: true, dir, text: say('order.noted', { project, id }), echo: say('order.echoNote', { id, text }) };
  }
  if (o.kind === 'action') {
    if (!Number.isInteger(o.ref) || !ACTIONS.includes(o.action)) return { ok: false, text: say('order.bad') };
    // runAction checks again that the block is open and offers this action, and that no run holds the project.
    const r = runAction(dir, o.ref, o.action, { origin: 'director', env, now });
    return { ok: r.ok, dir, text: `${project}: ${r.text}`, echo: r.ok ? say('order.echoAction', { action: say(`action.${o.action}`), text: r.text }) : null };
  }
  return { ok: false, text: say('order.bad') };
}
