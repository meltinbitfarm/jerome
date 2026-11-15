// The push of a project's main branch when the user unlocked it (D194): done by Jérôme, never by the model, whose
// `git push` stays denied. Once the main branch has commits not pushed and no run is working, the watchdog asks the
// user on Telegram with two buttons; on their yes the bridge pushes that branch, and only that branch, to its remote,
// if it has not moved since the question. "Not now" is not asked again until new commits come.
// Not more often than every 4 hours (D198): meanwhile the commits add up, and one push, with one deploy, takes them all.
// Sooner, at most every hour, when the lead agent marks a commit on that branch for it, a milestone reached or a bug
// fixed that users see online, with a `Jerome-Push: <why>` line ending its message; the question says why.
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
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
const statePath = (dir, target = null) => join(storeDir(dir), target?.repo ? `push-${repoId(target.repo)}.json` : 'push.json');
const repoId = (repo) => createHash('sha256').update(repo).digest('hex').slice(0, 12);
const reposPath = (dir) => join(storeDir(dir), 'push-repos.json');

// The other repositories whose main branch the user let Jérôme push for this project (D214), such as the sites a
// marketing project works on: kept in the project's store, outside any repository, set only at a terminal on this
// Mac. { '/abs/path': { at } }.
export function pushRepos(dir) {
  try {
    return JSON.parse(readFileSync(reposPath(dir), 'utf8'));
  } catch {
    return {};
  }
}

export function savePushRepos(dir, repos) {
  mkdirSync(storeDir(dir), { recursive: true });
  if (!Object.keys(repos).length) rmSync(reposPath(dir), { force: true });
  else writeFileSync(reposPath(dir), `${JSON.stringify(repos, null, 2)}\n`);
}

// Forgets one, with its question.
export function dropPushRepo(dir, repo) {
  const repos = pushRepos(dir);
  delete repos[repo];
  savePushRepos(dir, repos);
  rmSync(statePath(dir, { repo }), { force: true });
}

// What may be pushed for this project: its own repository when the push is unlocked, and the repositories added (D214).
// Each { repo, label }: repo null for the project's own, label the folder's name shown to the user, or null.
export function pushTargets(dir) {
  const own = isUnlocked(dir, 'push') ? [{ repo: null, label: null }] : [];
  return [...own, ...Object.keys(pushRepos(dir)).map((repo) => ({ repo, label: basename(repo) }))];
}

// The branch as the user reads it: "main", or "main of skei-landing".
const named = (target, branch, code) => (target.label ? t('push.of', { branch, repo: target.label }, code) : branch);
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

function readState(dir, target = null) {
  try {
    return JSON.parse(readFileSync(statePath(dir, target), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(dir, state, target = null) {
  mkdirSync(storeDir(dir), { recursive: true });
  writeFileSync(statePath(dir, target), JSON.stringify(state));
}

// Where the main branch stands against its remote: { branch, remote, head, ahead, subjects }, or null when the push
// is locked or the branch has no remote branch to compare with.
export function pushStatus(dir, target = { repo: null }) {
  if (!target.repo && !isUnlocked(dir, 'push')) return null;
  if (target.repo && (!pushRepos(dir)[target.repo] || !existsSync(target.repo))) return null;
  const where = target.repo ?? dir;
  // Another repository's main branch is the one its remote's HEAD names, else main.
  const branch = target.repo ? (out(git(where, 'symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD')) ?? 'origin/main').replace(/^[^/]+\//, '') : heartbeatConfig(dir).config.mainBranch;
  const remote = out(git(where, 'config', `branch.${branch}.remote`)) || 'origin';
  const head = out(git(where, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`));
  const upstream = `refs/remotes/${remote}/${branch}`;
  if (!head || !out(git(where, 'rev-parse', '--verify', '-q', upstream))) return null;
  const ahead = Number(out(git(where, 'rev-list', '--count', `${upstream}..${head}`)) ?? 0);
  const subjects = ahead ? (out(git(where, 'log', '--no-merges', '--format=%s', '-5', `${upstream}..${head}`)) ?? '').split('\n').filter(Boolean) : [];
  return { branch, remote, head, ahead, subjects, sooner: ahead ? sooner(where, `${upstream}..${head}`) : null };
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
  let item = null;
  // One question for each repository with commits not pushed, each at its own pace (D214).
  for (const target of pushTargets(dir)) item = proposeOne(dir, target, { env, now, enqueue }) ?? item;
  return item;
}

function proposeOne(dir, target, { env, now, enqueue }) {
  const s = pushStatus(dir, target);
  const state = readState(dir, target);
  if (!s || !s.ahead) {
    if (state.asked) writeState(dir, { ...state, asked: null }, target);
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
  const branch = named(target, s.branch, code);
  const text = t('push.ask', { count: s.ahead, branch, after: lastPushed(state, now), why, subjects: s.subjects.map((x) => `• ${x.slice(0, 100)}`).join('\n') }, code);
  const item = { dir, text, push: { head: short(s.head), branch }, now };
  enqueue(item);
  const asked = { head: s.head, at: now.toISOString(), count: s.ahead, subjects: s.subjects, ...(why ? { why } : {}) };
  writeState(dir, { ...state, asked, last: now.toISOString(), ...(s.sooner ? { sooner: s.sooner.sha } : {}) }, target);
  return item;
}

// The question asked and not answered yet, for the Director's dashboard (D196): { head, branch, count, subjects,
// after, why }, as asked, even when the branch has moved since; a tap then asks again with the new commits.
export function pushPending(dir, { now = new Date(), env = process.env } = {}) {
  return pushesPending(dir, { now, env })[0] ?? null;
}

// Every question asked and not answered yet, the project's own first, then the other repositories' (D214).
export function pushesPending(dir, { now = new Date(), env = process.env } = {}) {
  const all = [];
  for (const target of pushTargets(dir)) {
    const state = readState(dir, target);
    const asked = state.asked;
    if (!asked?.head) continue;
    const s = pushStatus(dir, target);
    if (!s?.ahead) continue;
    const same = s.head === asked.head;
    all.push({ head: short(asked.head), branch: named(target, s.branch, lang(env)), count: same ? s.ahead : asked.count ?? s.ahead, subjects: same ? s.subjects : asked.subjects ?? s.subjects,
      after: lastPushed(state, now), ...(asked.why ? { why: asked.why } : {}) });
  }
  return all;
}

// Whether the question with this head is still one to answer: the bridge takes the buttons off the others.
export function pushAsked(dir, head) {
  return pushTargets(dir).some((target) => short(readState(dir, target).asked?.head) === head);
}

// Which repository a question's head is about: the one that asked it, else the one at that head, else the project's.
function targetOf(dir, head) {
  const all = pushTargets(dir);
  return all.find((x) => short(readState(dir, x).asked?.head) === head) ?? all.find((x) => short(pushStatus(dir, x)?.head) === head) ?? { repo: null, label: null };
}

// The user's tap: 'go' pushes, 'no' waits for new commits. Returns { ok, text } in their language.
export function answerPush(dir, head, choice, { origin, env = process.env, now = new Date() } = {}) {
  const code = lang(env);
  const target = targetOf(dir, head);
  const s = pushStatus(dir, target);
  // The texts name the repository when it is not the project's own.
  const say = (key, values) => t(key, values?.branch ? { ...values, branch: named(target, values.branch, code) } : values, code);
  if (!s) return { ok: false, text: say(target.repo || isUnlocked(dir, 'push') ? 'push.noRemote' : 'push.locked') };
  if (!s.ahead) return { ok: true, text: say('push.nothing', { branch: s.branch }) };
  const state = readState(dir, target);
  const save = (next) => writeState(dir, next, target);
  // The branch moved since the question: on a yes asked again at once, with the new commits, since the user is there;
  // a no takes the new commits too.
  if (short(s.head) !== head) {
    if (short(state.asked?.head) !== head) return { ok: false, text: say('push.moved', { branch: s.branch }) };
    if (choice === 'no') {
      save({ ...state, asked: null, declined: s.head, last: now.toISOString() });
      return { ok: true, text: say('push.later', { branch: s.branch }) };
    }
    save({ ...state, asked: null, last: null });
    return { ok: false, text: say('push.moved', { branch: s.branch }) };
  }
  if (choice === 'no') {
    save({ ...state, asked: null, declined: s.head, last: now.toISOString() });
    return { ok: true, text: say('push.later', { branch: s.branch }) };
  }
  if (lockHolder(dir) !== null) return { ok: false, retry: true, text: say('acted.busy') };
  // That branch only, by name, to its own remote: nothing else is pushed, and never with force.
  const r = spawnSync('git', ['push', s.remote, `refs/heads/${s.branch}:refs/heads/${s.branch}`], {
    cwd: target.repo ?? dir, encoding: 'utf8', timeout: 120_000, env: { ...env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.status !== 0) {
    const error = scrub((r.stderr || r.stdout || r.error?.message || `git exited with ${r.status}`).trim().split('\n').filter(Boolean).pop() ?? '').slice(0, 200);
    return { ok: false, retry: true, text: say('push.failed', { branch: s.branch, error }) };
  }
  save({ ...state, asked: null, declined: null, last: now.toISOString(), pushed: { head: s.head, at: now.toISOString(), by: origin } });
  const db = openDb(dir);
  if (db) {
    try {
      addNote(db, `From the user, by a button: ${target.label ? `${s.branch} of ${target.label}` : s.branch} pushed (${s.ahead} commits, up to ${short(s.head)}). Whatever in open.md or an open request waits for this push is done.`, { source: origin, now });
    } finally {
      db.close();
    }
  }
  return { ok: true, text: say('push.done', { count: s.ahead, branch: s.branch }) };
}
