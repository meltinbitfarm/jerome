// A Mac's side of Jérôme Director (D145-D152): `jerome connect <url>`, `jerome connect status`, `jerome disconnect`,
// and the beat the watchdog sends every minute. The Mac's private key never leaves it; the Director's key is pinned
// at connect, once Fabio has compared its fingerprint, and any response not signed with it is ignored (D146). What
// the beat carries is listed in D147: percentages, the projects' state and their finished runs, never a credential,
// code, prompts, transcripts or paths; and, since D177, each project's board: the texts of its work items and runs.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { newKeys, fingerprint, signRequest, verifyResponse } from './sign.js';
import { VERSION, MARKER } from './template.js';
import { stores } from './store.js';
import { openDb } from './db.js';
import { readAccount } from './account.js';
import { refreshQuota, readingTime } from './quota.js';
import { governorSettings } from './governor.js';
import { heartbeatConfig, describeSlot } from './heartbeatconfig.js';
import { openAlerts } from './alerts.js';
import { scrub } from './scrub.js';
import { lang } from './i18n.js';
import { projectBoard } from './board.js';
import { createHash } from 'node:crypto';
import { projectStatus, projectOver } from './budget.js';
import { lockHolder, cacheDir } from './runstate.js';
import { runOrders } from './orders.js';

export function linkPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jerome', 'director.json');
}
const statePath = () => cacheDir('director', 'state.json');

export function readLink(env = process.env) {
  try {
    return JSON.parse(readFileSync(linkPath(env), 'utf8'));
  } catch {
    return null;
  }
}

function writeLink(link, env) {
  const file = linkPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return { cursors: {} };
  }
}

function writeState(state) {
  mkdirSync(dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state));
}

// A signed request to the Director; the answer counts only when the Director signed it, with the key pinned (or, at
// the first hello, with the key it carries, which Fabio then compares).
async function call(link, path, payload, { pinned = link.director?.publicKey } = {}) {
  const body = JSON.stringify(payload);
  const headers = signRequest({ method: 'POST', path, body, machine: link.machine, privatePem: link.key.private });
  let r;
  try {
    r = await fetch(new URL(path, link.url), { method: 'POST', body, headers: { ...headers, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    return { error: `the Director did not answer: ${err.cause?.code ?? err.message}` };
  }
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: `the Director answered ${r.status} with no JSON` };
  }
  const key = pinned ?? data.director?.publicKey;
  if (!key || !verifyResponse({ status: r.status, body: text, nonce: headers['x-jerome-nonce'], headers: r.headers, publicPem: key })) {
    return { error: 'the answer is not signed by the Director: ignored' };
  }
  return { status: r.status, data };
}

// `jerome connect <url>`: a key for this Mac, the Director's fingerprint compared and pinned, and the code to approve.
export async function connect(url, { name = hostname().replace(/\.local$/, ''), env = process.env, input = process.stdin, output = process.stdout } = {}) {
  let base;
  try {
    base = new URL(url);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error();
  } catch {
    console.error(`${url} is not an address: give the Director's, such as http://100.101.102.103:7788`);
    return 2;
  }
  const old = readLink(env);
  const key = old?.url === base.href ? old.key : newKeys();
  const link = { url: base.href, name: String(name).slice(0, 60), machine: fingerprint(key.public), key };
  const r = await call(link, '/v1/hello', { name: link.name, publicKey: key.public, version: VERSION }, { pinned: old?.url === base.href ? old.director?.publicKey : null });
  if (r.error) {
    console.error(`Cannot connect: ${r.error}.`);
    return 1;
  }
  if (r.status >= 400) {
    console.error(`The Director refused: ${r.data.error}.`);
    return 1;
  }
  const director = r.data.director;
  if (!old?.director || old.director.publicKey !== director.publicKey) {
    console.log(`The Director's fingerprint is ${director.fingerprint}.`);
    const answer = await ask(input, output, 'Is it the one `jerome director init` printed on the server? [y/N] ');
    if (!/^(y|yes|s|si|sì)$/i.test(answer)) {
      console.error('Not connected: a different fingerprint means you are not talking to your Director.');
      return 1;
    }
  }
  writeLink({ ...link, director, connectedAt: new Date().toISOString() }, env);
  writeState({ cursors: {}, status: r.data.status });
  if (r.data.status === 'approved') {
    console.log(`✓ Connected as ${link.name}, already approved: the watchdog sends its beat every minute.`);
    return 0;
  }
  console.log(`✓ ${link.name} is waiting for approval. Its code: ${link.machine}`);
  console.log(`  On the server: jerome director approve ${link.machine}`);
  console.log(`  (with Docker: docker compose exec director jerome director approve ${link.machine})`);
  console.log('  The watchdog sends its first beat as soon as it is approved (`jerome watchdog install` if it is not).');
  return 0;
}

function ask(input, output, question) {
  const rl = createInterface({ input, output, terminal: false });
  output.write(question);
  return new Promise((done) => {
    let answered = false;
    rl.once('line', (l) => {
      answered = true;
      rl.close();
      done(String(l).trim());
    });
    rl.once('close', () => { if (!answered) done(''); });
  });
}

const minutesAgo = (iso, now = Date.now()) => `${Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))} min ago`;

export async function connectStatus({ env = process.env } = {}) {
  const link = readLink(env);
  if (!link) {
    console.log('Not connected to a Director: `jerome connect <address>`. The quota governor, if on, works on this Mac alone.');
    return 0;
  }
  const s = readState();
  console.log(`director ${link.url} · fingerprint ${link.director.fingerprint}`);
  console.log(`this mac ${link.name} · code ${link.machine} · ${s.status === 'approved' ? 'approved' : s.status === 'revoked' ? 'revoked on the Director' : `waiting for approval: on the server, jerome director approve ${link.machine}`}`);
  console.log(`beat     ${s.lastOk ? `last answered ${minutesAgo(s.lastOk)}` : 'never answered yet'}${s.lastError ? ` · last error ${minutesAgo(s.lastErrorAt)}: ${s.lastError}` : ''}`);
  return 0;
}

export async function disconnect({ env = process.env } = {}) {
  const link = readLink(env);
  rmSync(linkPath(env), { force: true });
  rmSync(statePath(), { force: true });
  console.log(link ? `✓ Disconnected from ${link.url}. Its key is deleted here; \`jerome director revoke ${link.name}\` on the server removes it there.` : 'Not connected to a Director.');
  return 0;
}

const cut = (text, n) => scrub(text).slice(0, n);
// A board is sent again after this, even unchanged; the boards of one beat stay under this many characters.
const BOARD_RESEND_MS = 30 * 60_000;
const BOARD_BYTES = 150_000;
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// One project as the beat tells it (D147): its state, never its path or its files.
function projectBeat(s, filled, cursors, now) {
  const dir = s.record.path;
  const { config } = heartbeatConfig(dir);
  const db = openDb(dir, { readOnly: true, migrate: false });
  if (!db) return null;
  try {
    const status = projectStatus(dir, db, now);
    const last = db.prepare("SELECT started_at, status, reason FROM runs WHERE kind = 'heartbeat' AND status != 'running' ORDER BY id DESC LIMIT 1").get();
    let rows;
    try {
      rows = db.prepare("SELECT id, started_at, ended_at, status, reason, fill, quota FROM runs WHERE kind = 'heartbeat' AND status != 'running' AND id > ? ORDER BY id LIMIT 50").all(cursors[s.key] ?? 0);
    } catch {
      // A database from before schema 9.
      rows = db.prepare("SELECT id, started_at, ended_at, status, reason FROM runs WHERE kind = 'heartbeat' AND status != 'running' AND id > ? ORDER BY id LIMIT 50").all(cursors[s.key] ?? 0);
    }
    const runs = rows.map((r) => {
      const q = r.quota ? JSON.parse(r.quota) : null;
      return {
        project: s.key, id: r.id, kind: r.fill ? 'fill' : 'slot', model: q?.model ?? null, startedAt: r.started_at, endedAt: r.ended_at,
        status: cut(r.status, 20), reason: cut(r.reason, 200), quota: q ? { before: q.before ?? {}, after: q.after ?? {} } : null,
      };
    });
    const project = {
      key: s.key,
      name: cut(basename(dir), 100),
      fill: filled.has(real(dir)),
      running: Boolean(lockHolder(dir)),
      slots: config.slots.slice(0, 20).map((x) => ({ name: cut(x.name, 40), at: cut(describeSlot(x), 200) })),
      alerts: openAlerts(db).slice(0, 50).map((a) => ({ id: a.id, reason: cut(a.reason, 200), count: a.count, openedAt: a.openedAt })),
      requests: db.prepare("SELECT id, question, options, recommendation FROM requests WHERE status = 'open' ORDER BY id LIMIT 50").all()
        .map((r) => ({ id: r.id, question: cut(r.question, 200), options: r.options ? cut(r.options, 200) : null, recommendation: r.recommendation ? cut(r.recommendation, 200) : null })),
      overLimit: Boolean(projectOver(status)),
      lastHeartbeat: last ? { at: last.started_at, status: cut(last.status, 20), reason: cut(last.reason, 200) } : null,
      usage: { today: { tokens: status.daily.tokens, usd: status.daily.usd }, week: { tokens: status.weekly.tokens, usd: status.weekly.usd } },
    };
    return { project, runs };
  } finally {
    db.close();
  }
}

// What account.json holds, as the beat carries it: percentages and resets only.
function quotaBeat(account) {
  const at = readingTime(account);
  if (!at) return null;
  const windows = {};
  for (const [name, w] of Object.entries(account.windows ?? {})) {
    if (['five_hour', 'seven_day'].includes(name)) windows[name] = { used: w.used, resetsAt: w.resetsAt ?? null, readAt: w.readAt ?? null, source: cut(w.source, 20) || null };
  }
  return {
    readAt: at.toISOString(),
    windows,
    scoped: (account.quota?.scoped ?? []).slice(0, 10).map((x) => ({ model: cut(x.model, 60), used: x.used, resetsAt: x.resetsAt ?? null })),
    breakdown: (account.quota?.breakdown ?? []).slice(0, 10).map((x) => ({ key: cut(x.key, 40), name: cut(x.name, 60), percent: x.percent })),
  };
}

// The watchdog's beat, every minute (D148). The quota is read here too, at most every 5 minutes (D140), so the
// Director has the freshest reading of any Mac. Lines go to the log only when the outcome changes.
export async function directorBeat({ env = process.env, now = new Date(), log = () => {} } = {}) {
  const link = readLink(env);
  if (!link) return null;
  const state = readState();
  state.cursors ??= {};
  const account = await refreshQuota({ env, now });
  const quota = quotaBeat(account);
  const filled = new Set(governorSettings(account).projects.map(real));
  const projects = [];
  const runs = [];
  const code = lang(env);
  // The boards (D177) go when they changed, or every half hour in case the Director lost one, the oldest sent first,
  // as many as the beat's size allows.
  state.boards ??= {};
  const boards = [];
  for (const s of stores()) {
    if (s.orphan || !s.record?.path || !existsSync(join(s.record.path, MARKER))) continue;
    try {
      const b = projectBeat(s, filled, state.cursors, now);
      if (!b) continue;
      projects.push(b.project);
      runs.push(...b.runs);
      const board = { key: s.key, ...projectBoard(s.record.path, { now, code }) };
      const sum = createHash('sha256').update(JSON.stringify(board)).digest('hex').slice(0, 16);
      const sent = state.boards[s.key];
      if (!sent || sent.hash !== sum || now.getTime() - Date.parse(sent.at) > BOARD_RESEND_MS) boards.push({ board, sum, at: sent?.at ?? '' });
    } catch (err) {
      log(`director: ${s.key} left out of the beat: ${err.message}`);
    }
  }
  const sendQuota = quota && quota.readAt !== state.quotaReadAt;
  const sending = [];
  let size = 0;
  for (const b of boards.sort((x, y) => x.at.localeCompare(y.at))) {
    const n = JSON.stringify(b.board).length;
    if (size + n > BOARD_BYTES) continue;
    size += n;
    sending.push(b);
  }
  // Results of the dashboard's orders whose quick report did not get through go with the beat (D191).
  state.orders ??= { done: {}, unsent: [] };
  const unsent = state.orders.unsent.slice(0, 50);
  const r = await call(link, '/v1/beat', { version: VERSION, at: now.toISOString(), language: code, quota: sendQuota ? quota : null, projects: projects.slice(0, 100), runs: runs.slice(0, 50),
    // Only when there is one: a Director from before 0.13.0 refuses a field it does not know.
    boards: sending.map((b) => b.board), ...(unsent.length ? { results: unsent } : {}) });
  const problem = r.error ?? (r.status >= 400 ? r.data.error : null);
  if (problem) {
    if (problem !== state.lastError) log(`director: ${problem}`);
    const status = r.status === 403 ? (/revoked/.test(problem) ? 'revoked' : 'pending') : state.status;
    writeState({ ...state, status, lastError: problem, lastErrorAt: now.toISOString() });
    return { error: problem };
  }
  if (state.lastError || state.status !== 'approved') log('director: beat answered');
  for (const run of runs.slice(0, 50)) state.cursors[run.project] = Math.max(state.cursors[run.project] ?? 0, run.id);
  for (const b of sending) state.boards[b.board.key] = { hash: b.sum, at: now.toISOString() };
  state.orders.unsent = state.orders.unsent.slice(unsent.length);
  // The dashboard's orders (D169, D191): run here under this Mac's own checks, then reported at once.
  if (Array.isArray(r.data.orders) && r.data.orders.length) {
    const results = runOrders(r.data.orders, { done: state.orders.done, env, now });
    for (const x of results) log(`director: order ${x.id} ${x.ok ? 'done' : 'not done'}: ${x.text}`);
    const sent = await call(link, '/v1/results', { results: results.slice(0, 50) });
    if (sent.error || sent.status >= 400) state.orders.unsent.push(...results);
  }
  // An order is remembered a day, so one given again is reported rather than run twice.
  const day = now.getTime() - 86_400_000;
  for (const [id, x] of Object.entries(state.orders.done)) if (Date.parse(x.at) < day) delete state.orders.done[id];
  writeState({ ...state, status: 'approved', lastOk: now.toISOString(), lastError: null, lastErrorAt: null, quotaReadAt: sendQuota ? quota.readAt : state.quotaReadAt });
  return r.data;
}
