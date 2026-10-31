// The push of a project's main branch when the user unlocked it (D194): done by Jérôme, never by the model, whose
// `git push` stays denied. Once the main branch has commits not pushed and no run is working, the watchdog asks the
// user on Telegram with two buttons; on their yes the bridge pushes that branch, and only that branch, to its remote,
// if it has not moved since the question. "Not now" is not asked again until new commits come.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { storeDir } from './store.js';
import { isUnlocked } from './rules.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { lockHolder } from './runstate.js';
import { openDb } from './db.js';
import { addNote } from './notes.js';
import { scrub } from './scrub.js';
import { t, lang } from './i18n.js';

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const out = (r) => (r.status === 0 ? r.stdout.trim() : null);
const statePath = (dir) => join(storeDir(dir), 'push.json');
export const short = (sha) => String(sha ?? '').slice(0, 12);

function readState(dir) {
  try {
    return JSON.parse(readFileSync(statePath(dir), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(dir, state) {
  mkdirSync(storeDir(dir), { recursive: true });
  writeFileSync(statePath(dir), JSON.stringify(state));
}

// Where the main branch stands against its remote: { branch, remote, head, ahead, subjects }, or null when the push
// is locked or the branch has no remote branch to compare with.
export function pushStatus(dir) {
  if (!isUnlocked(dir, 'push')) return null;
  const branch = heartbeatConfig(dir).config.mainBranch;
  const remote = out(git(dir, 'config', `branch.${branch}.remote`)) || 'origin';
  const head = out(git(dir, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`));
  const upstream = `refs/remotes/${remote}/${branch}`;
  if (!head || !out(git(dir, 'rev-parse', '--verify', '-q', upstream))) return null;
  const ahead = Number(out(git(dir, 'rev-list', '--count', `${upstream}..${head}`)) ?? 0);
  const subjects = ahead ? (out(git(dir, 'log', '--no-merges', '--format=%s', '-5', `${upstream}..${head}`)) ?? '').split('\n').filter(Boolean) : [];
  return { branch, remote, head, ahead, subjects };
}

// The watchdog's pass: the question, once for each new head of the main branch. Returns the item queued, if any.
export function proposePush(dir, { env = process.env, now = new Date(), enqueue }) {
  const s = pushStatus(dir);
  const state = readState(dir);
  if (!s || !s.ahead) {
    if (state.asked) writeState(dir, { ...state, asked: null });
    return null;
  }
  // A run may merge more: asked once it has ended.
  if (lockHolder(dir) !== null) return null;
  if (state.asked?.head === s.head || state.declined === s.head) return null;
  const code = lang(env);
  const text = t('push.ask', { count: s.ahead, branch: s.branch, subjects: s.subjects.map((x) => `• ${x.slice(0, 100)}`).join('\n') }, code);
  const item = { dir, text, push: { head: short(s.head), branch: s.branch }, now };
  enqueue(item);
  writeState(dir, { ...state, asked: { head: s.head, at: now.toISOString() } });
  return item;
}

// Whether the question with this head is still the one to answer: the bridge takes the buttons off the others.
export function pushAsked(dir, head) {
  return short(readState(dir).asked?.head) === head;
}

// The user's tap: 'go' pushes, 'no' waits for new commits. Returns { ok, text } in their language.
export function answerPush(dir, head, choice, { origin, env = process.env, now = new Date() } = {}) {
  const say = (key, values) => t(key, values, lang(env));
  const s = pushStatus(dir);
  if (!s) return { ok: false, text: say(isUnlocked(dir, 'push') ? 'push.noRemote' : 'push.locked') };
  if (!s.ahead) return { ok: true, text: say('push.nothing', { branch: s.branch }) };
  if (short(s.head) !== head) return { ok: false, text: say('push.moved', { branch: s.branch }) };
  const state = readState(dir);
  if (choice === 'no') {
    writeState(dir, { ...state, asked: null, declined: s.head });
    return { ok: true, text: say('push.later', { branch: s.branch }) };
  }
  if (lockHolder(dir) !== null) return { ok: false, retry: true, text: say('acted.busy') };
  // That branch only, by name, to its own remote: nothing else is pushed, and never with force.
  const r = spawnSync('git', ['push', s.remote, `refs/heads/${s.branch}:refs/heads/${s.branch}`], {
    cwd: dir, encoding: 'utf8', timeout: 120_000, env: { ...env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.status !== 0) {
    const error = scrub((r.stderr || r.stdout || r.error?.message || `git exited with ${r.status}`).trim().split('\n').filter(Boolean).pop() ?? '').slice(0, 200);
    return { ok: false, retry: true, text: say('push.failed', { branch: s.branch, error }) };
  }
  writeState(dir, { ...state, asked: null, declined: null, pushed: { head: s.head, at: now.toISOString(), by: origin } });
  const db = openDb(dir);
  if (db) {
    try {
      addNote(db, `From the user, by a button: ${s.branch} pushed (${s.ahead} commits, up to ${short(s.head)}). Whatever in open.md or an open request waits for this push is done.`, { source: origin, now });
    } finally {
      db.close();
    }
  }
  return { ok: true, text: say('push.done', { count: s.ahead, branch: s.branch }) };
}
