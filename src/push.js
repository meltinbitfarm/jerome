// The push of a project's main branch when the user unlocked it (D194): done by Jérôme, never by the model, whose
// `git push` stays denied. Once the main branch has commits not pushed and no run is working, the watchdog asks the
// user on Telegram with two buttons; on their yes the bridge pushes that branch, and only that branch, to its remote,
// if it has not moved since the question. "Not now" is not asked again until new commits come.
// Not more often than every 4 hours (D198): meanwhile the commits add up, and one push, with one deploy, takes them all.
// Sooner, at most every hour, when the lead agent marks a commit on that branch for it, a milestone reached or a bug
// fixed that users see online, with a `Jerome-Push: <why>` line ending its message; the question says why.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { storeDir } from './store.js';
import { isUnlocked } from './unlocked.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { lockHolder } from './runstate.js';
import { openDb } from './db.js';
import { addNote } from './notes.js';
import { scrub } from './scrub.js';
import { t, lang } from './i18n.js';

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const out = (r) => (r.status === 0 ? r.stdout.trim() : null);
const statePath = (dir) => join(storeDir(dir), 'push.json');
export const PUSH_EVERY_MS = 4 * 3_600_000;
export const PUSH_SOONER_MS = 3_600_000;
export const TRAILER = 'Jerome-Push';
export const short = (sha) => String(sha ?? '').slice(0, 12);
const pad = (x) => String(x).padStart(2, '0');

// When the last push by a button was, on this Mac's clock, so the next question reads as new commits (D197): the time
// that day, else the day and the time.
function lastPushed(state, now) {
  const d = new Date(state.pushed?.at ?? NaN);
  if (Number.isNaN(d.getTime())) return null;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? { time } : { day: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, time };
}

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
  return { branch, remote, head, ahead, subjects, sooner: ahead ? sooner(dir, `${upstream}..${head}`) : null };
}

// The newest commit not pushed that the lead agent marked for a push sooner: { sha, why }, or null.
function sooner(dir, range) {
  const lines = (out(git(dir, 'log', `--format=%H%x09%(trailers:key=${TRAILER},valueonly,separator=%x20)`, range)) ?? '').split('\n');
  for (const line of lines) {
    const [sha, why] = line.split('\t');
    if (why?.trim()) return { sha, why: scrub(why.trim()).slice(0, 200) };
  }
  return null;
}

// The watchdog's pass: the question, for a head of the main branch not asked yet, at most every 4 hours, or every hour
// for a commit marked by the lead agent (D198). Returns the item queued, if any.
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
  // Since the last question, answer or push; null when a tap found the branch moved, to ask again now. A state from
  // before 0.17.0 has none: its question or push stands for it.
  const last = Date.parse((state.last === undefined ? state.asked?.at ?? state.pushed?.at : state.last) ?? '');
  const since = Number.isNaN(last) ? Infinity : now.getTime() - last;
  const why = s.sooner && s.sooner.sha !== state.sooner ? s.sooner.why : null;
  if (since < PUSH_EVERY_MS && !(why && since >= PUSH_SOONER_MS)) return null;
  const code = lang(env);
  const text = t('push.ask', { count: s.ahead, branch: s.branch, after: lastPushed(state, now), why, subjects: s.subjects.map((x) => `• ${x.slice(0, 100)}`).join('\n') }, code);
  const item = { dir, text, push: { head: short(s.head), branch: s.branch }, now };
  enqueue(item);
  const asked = { head: s.head, at: now.toISOString(), count: s.ahead, subjects: s.subjects, ...(why ? { why } : {}) };
  writeState(dir, { ...state, asked, last: now.toISOString(), ...(s.sooner ? { sooner: s.sooner.sha } : {}) });
  return item;
}

// The question asked and not answered yet, for the Director's dashboard (D196): { head, branch, count, subjects,
// after, why }, as asked, even when the branch has moved since; a tap then asks again with the new commits.
export function pushPending(dir, { now = new Date() } = {}) {
  const state = readState(dir);
  const asked = state.asked;
  if (!asked?.head) return null;
  const s = pushStatus(dir);
  if (!s?.ahead) return null;
  const same = s.head === asked.head;
  return { head: short(asked.head), branch: s.branch, count: same ? s.ahead : asked.count ?? s.ahead, subjects: same ? s.subjects : asked.subjects ?? s.subjects,
    after: lastPushed(state, now), ...(asked.why ? { why: asked.why } : {}) };
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
  const state = readState(dir);
  // The branch moved since the question: on a yes asked again at once, with the new commits, since the user is there;
  // a no takes the new commits too.
  if (short(s.head) !== head) {
    if (short(state.asked?.head) !== head) return { ok: false, text: say('push.moved', { branch: s.branch }) };
    if (choice === 'no') {
      writeState(dir, { ...state, asked: null, declined: s.head, last: now.toISOString() });
      return { ok: true, text: say('push.later', { branch: s.branch }) };
    }
    writeState(dir, { ...state, asked: null, last: null });
    return { ok: false, text: say('push.moved', { branch: s.branch }) };
  }
  if (choice === 'no') {
    writeState(dir, { ...state, asked: null, declined: s.head, last: now.toISOString() });
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
  writeState(dir, { ...state, asked: null, declined: null, last: now.toISOString(), pushed: { head: s.head, at: now.toISOString(), by: origin } });
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
