// Unblocking from afar (D166-D169): a lasting block comes with two or three fixed actions, chosen by its kind, which
// the user taps on Telegram (and, later, on the Director's dashboard). An action is a name from the closed list
// below with the alert's id, never a command or free text; each is reversible and stays inside the project: changes
// are set aside, never discarded, and nothing is pushed, merged or deployed (D167).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { blockKind } from './blocks.js';
import { addNote } from './notes.js';
import { clearResume, currentBranch, lockHolder, operationInProgress, uncommitted } from './runstate.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { readMarker } from './template.js';
import { DEFAULT_CAPS, jobLabel, logPath } from './schedule.js';
import { t, lang } from './i18n.js';

const BIN = join(import.meta.dirname, '..', 'bin', 'jerome.js');
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

// The actions each kind of block offers. A folder not trusted in Claude Code, a provisional PROJECT.md and a folder
// with no git have none: the first is Claude's own security prompt, the others a choice for a session.
const OFFERED = {
  yours: ['commit', 'stash'],
  cap: ['budget', 'skip'],
  denied: ['did', 'skip'],
  branch: ['main'],
  detached: ['main'],
  operation: ['main'],
  untrusted: [],
  provisional: [],
  nogit: [],
};
export const ACTIONS = ['commit', 'stash', 'budget', 'skip', 'did', 'main', 'retry'];

// The actions a block offers, from its reason; anything not listed above is tried again.
export function actionsFor(reason) {
  return OFFERED[blockKind(reason).kind] ?? ['retry'];
}

// A heartbeat started apart, its output in the project's log, as the governor starts a fill run.
function startHeartbeat(dir, env, args = []) {
  const file = logPath(jobLabel(dir));
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  spawn(process.execPath, [BIN, 'heartbeat', ...args, dir], { env, detached: true, stdio: ['ignore', fd, fd] }).unref();
  closeSync(fd);
}

// Runs one action on one open alert of the project. Returns { ok, text }, the text for the user in their language.
// `origin` says where the tap came from ('telegram', 'director'), recorded with the alert it closes.
export function runAction(dir, alertId, action, { origin, env = process.env, now = new Date(), start = startHeartbeat } = {}) {
  const code = lang(env);
  const say = (key, values) => t(key, values, code);
  const db = openDb(dir);
  if (!db) return { ok: false, text: say('acted.gone') };
  try {
    const alert = db.prepare('SELECT id, reason, status FROM alerts WHERE id = ?').get(Number(alertId));
    if (!alert || alert.status !== 'open' || !actionsFor(alert.reason).includes(action)) return { ok: false, text: say('acted.gone') };
    if (lockHolder(dir) !== null) return { ok: false, text: say('acted.busy') };
    const resolve = () => db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ?")
      .run(now.toISOString(), `${origin}:${action}`, alert.id);
    const failed = (r) => ({ ok: false, text: say('acted.failed', { error: (r.stderr || r.stdout || '').trim().split('\n')[0] || `git exited with ${r.status}` }) });
    const note = (text) => addNote(db, text, { source: origin, now });

    if (action === 'commit' || action === 'stash') {
      const files = uncommitted(dir) ?? [];
      if (!files.length) {
        resolve();
        return { ok: true, text: say('acted.nothing') };
      }
      const r = action === 'commit'
        ? git(dir, 'commit', '-m', `Kept by the user from afar (Jérôme A${alert.id})`, '--', ...files)
        : git(dir, 'stash', 'push', '-m', `Jérôme: set aside from afar (A${alert.id})`, '--', ...files);
      if (r.status !== 0) return failed(r);
      resolve();
      return { ok: true, text: say(`acted.${action}`, { files: files.slice(0, 3).join(', ') + (files.length > 3 ? ', …' : '') }) };
    }
    if (action === 'main') {
      const op = operationInProgress(dir);
      if (op) {
        const r = git(dir, op, '--abort');
        if (r.status !== 0) return failed(r);
      }
      if ((uncommitted(dir) ?? []).length) return { ok: false, text: say('acted.dirty') };
      const { mainBranch } = heartbeatConfig(dir).config;
      if (currentBranch(dir) !== mainBranch) {
        const r = git(dir, 'checkout', '-q', mainBranch);
        if (r.status !== 0) return failed(r);
      }
      resolve();
      return { ok: true, text: say('acted.main', { branch: mainBranch }) };
    }
    if (action === 'skip') {
      // The lead agent reads notes as the user's words; this one is Jérôme's fixed text, with the runner's reason quoted.
      note(`From the user, by a button: leave the work behind this block and take another task; record it in open.md. The block: ${alert.reason}`);
      clearResume(dir);
      resolve();
      return { ok: true, text: say('acted.skip') };
    }
    if (action === 'did') {
      note(`From the user, by a button: they did themselves what this block needed, so go on from there. The block: ${alert.reason}`);
      resolve();
      return { ok: true, text: say('acted.did') };
    }
    if (action === 'budget') {
      // A run with caps given for that run only (D108): its own stop by them is not counted as a block again.
      const caps = readMarker(dir).heartbeat ?? {};
      start(dir, env, ['--max-tokens', String(2 * (caps.maxTokens ?? DEFAULT_CAPS.maxTokens)), '--max-turns', String(2 * (caps.maxTurns ?? DEFAULT_CAPS.maxTurns))]);
      resolve();
      return { ok: true, text: say('acted.budget') };
    }
    // retry: a run now, which closes the alert if it ends well.
    start(dir, env);
    return { ok: true, text: say('acted.retry') };
  } finally {
    db.close();
  }
}
