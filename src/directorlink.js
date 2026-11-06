// A Mac's side of Jérôme Director (D145-D152): `jerome connect <url>`, `jerome connect status`, `jerome disconnect`,
// and the beat the watchdog sends every minute. The Mac's private key never leaves it; the Director's key is pinned
// at connect, once Fabio has compared its fingerprint, and any response not signed with it is ignored (D146). What
// the beat carries is listed in D147: percentages, the projects' state and their finished runs, never a credential,
// code, prompts, transcripts or paths; and, since D177, each project's board: the texts of its work items and runs.
// Step 3 (D148, D149): the permits in the Director's answer, checked here and run as this Mac would run its own work,
// and the slots' question before they run (askDirector).
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { newKeys, fingerprint, signRequest, verifyResponse } from './sign.js';
import { directorMode } from './directormode.js';
import { VERSION, MARKER, readMarker } from './template.js';
import { stores } from './store.js';
import { openDb } from './db.js';
import { readAccount } from './account.js';
import { refreshQuota, readingTime } from './quota.js';
import { governorSettings, fillBlock, launchRun } from './governor.js';
import { heartbeatConfig, describeSlot } from './heartbeatconfig.js';
import { linkPath, statePath, permitsPath, directorOutboxPath, readLink, readState, readPermits, SILENT_MS } from './directormode.js';
import { openAlerts } from './alerts.js';
import { scrub } from './scrub.js';
import { lang, t } from './i18n.js';
import { projectBoard } from './board.js';
import { NOTES_DIR } from './paths.js';
import { createHash } from 'node:crypto';
import { projectStatus, projectOver } from './budget.js';
import { lockHolder, cacheDir } from './runstate.js';
import { runOrders } from './orders.js';
import { unlocked } from './unlocked.js';
import { pushPending } from './push.js';

export { linkPath, readLink };

function writeLink(link, env) {
  const file = linkPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
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
  const mode = directorMode(env);
  console.log(`mode     ${!mode ? 'the Director only observes: this Mac keeps phase 1 (its own governor, if on)'
    : mode.mode === 'directed' ? `directed: fill runs and slots on the Director's permits${s.pace ? ` · pace ${s.pace.verdict}: ${s.pace.why}` : ''}`
      : `local since ${s.lastOk ?? 'never'}: the Director is silent, so slots run held at the 5-hour cap and the reserve, fill runs at most one every 2 hours`}`);
  const going = Object.entries(readPermits()).filter(([, p]) => Date.now() - Date.parse(p.at) < 12 * 3_600_000);
  if (going.length) console.log(`permits  ${going.map(([id, p]) => `${id} ${p.kind === 'slot' ? `slot ${p.slot}` : 'fill'} in ${basename(p.dir)}, ${minutesAgo(p.at)}`).join(' · ')}`);
  return 0;
}

export async function disconnect({ env = process.env } = {}) {
  const link = readLink(env);
  rmSync(linkPath(env), { force: true });
  rmSync(statePath(), { force: true });
  rmSync(permitsPath(), { force: true });
  console.log(link ? `✓ Disconnected from ${link.url}. Its key is deleted here; \`jerome director revoke ${link.name}\` on the server removes it there.` : 'Not connected to a Director.');
  return 0;
}

const cut = (text, n) => scrub(text).slice(0, n);
// Whether version a is at least b, as 0.16.0.
export function atLeast(a, b) {
  const x = String(a ?? '').split('.').map(Number);
  const y = b.split('.').map(Number);
  if (x.length !== 3 || x.some((n) => !Number.isInteger(n))) return false;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
}
// A board is sent again after this, even unchanged; the boards of one beat stay under this many characters.
const BOARD_RESEND_MS = 30 * 60_000;
const BOARD_BYTES = 150_000;
// The notes the boards' lines name (D207): sent when new or changed, again once a day in case the Director lost one,
// each cut to this many characters, those of one beat under this many.
const NOTE_RESEND_MS = 86_400_000;
const NOTE_TEXT = 12_000;
const NOTE_BYTES = 60_000;
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
      // For its permits (D201): the model its heartbeats use and their longest run.
      model: cut(readMarker(dir).heartbeat?.model ?? 'opus', 60),
      maxMinutes: config.maxMinutes,
    };
    // What the user unlocked here, and the push asked (D194-D196), for a Director that knows them.
    const open = Object.keys(unlocked(dir)).slice(0, 20).map((g) => cut(g, 20));
    const push = pushPending(dir);
    if (open.length) project.rules = { unlocked: open, ...(push ? { push: { head: push.head, branch: cut(push.branch, 60), count: push.count, subjects: push.subjects.slice(0, 5).map((x) => cut(x, 120)), ...(push.after ? { after: push.after } : {}), ...(push.why ? { why: cut(push.why, 200) } : {}) } } : {}) };
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

// One beat at a time on a Mac: the watchdog's and the one the Telegram bridge sends after an answer (D193) would
// otherwise read the same state and run the same orders twice. A lock older than two minutes is a beat that died.
const beatLock = () => cacheDir('director', 'beat.lock');
async function takeBeatLock(waitMs) {
  mkdirSync(dirname(beatLock()), { recursive: true });
  for (const end = Date.now() + waitMs; ; await new Promise((r) => setTimeout(r, 250))) {
    try {
      writeFileSync(beatLock(), String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      try {
        if (Date.now() - statSync(beatLock()).mtimeMs > 2 * 60_000) rmSync(beatLock(), { force: true });
      } catch {
        // Gone meanwhile: taken at the next try.
      }
    }
    if (Date.now() > end) return false;
  }
}

// The watchdog's beat, every minute (D148), and the bridge's, at once after the user acted on Telegram (D193). The
// quota is read here too, at most every 5 minutes (D140), so the Director has the freshest reading of any Mac. Lines
// go to the log only when the outcome changes.
export async function directorBeat({ env = process.env, now = new Date(), log = () => {} } = {}) {
  if (!readLink(env)) return null;
  // A beat already under way is waited for, so the one after it carries what changed meanwhile.
  if (!(await takeBeatLock(30_000))) return { busy: true };
  try {
    return await beat({ env, now, log });
  } finally {
    rmSync(beatLock(), { force: true });
  }
}

async function beat({ env, now, log }) {
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
  state.notes ??= {};
  const withNotes = atLeast(state.directorVersion, '0.21.0');
  const boards = [];
  const notes = [];
  const named = new Set();
  for (const s of stores()) {
    if (s.orphan || !s.record?.path || !existsSync(join(s.record.path, MARKER))) continue;
    try {
      const b = projectBeat(s, filled, state.cursors, now);
      if (!b) continue;
      projects.push(b.project);
      runs.push(...b.runs);
      const board = { key: s.key, ...projectBoard(s.record.path, { now, code }) };
      const noted = new Set(board.done.flatMap((x) => x.notes ?? []));
      // The notes of the boards' lines (D207): only to a Director from 0.21.0, and the board sent again once it is.
      if (!withNotes) for (const x of board.done) delete x.notes;
      const sum = createHash('sha256').update(JSON.stringify(board)).digest('hex').slice(0, 16);
      const sent = state.boards[s.key];
      if (!sent || sent.hash !== sum || now.getTime() - Date.parse(sent.at) > BOARD_RESEND_MS) boards.push({ board, sum, at: sent?.at ?? '' });
      for (const name of withNotes ? noted : []) {
        named.add(`${s.key}/${name}`);
        let text;
        try {
          // With no path, as every text that leaves the Mac, its lines and their indent kept.
          text = readFileSync(join(s.record.path, NOTES_DIR, name), 'utf8').split('\n').map((l) => `${l.match(/^\s*/)[0]}${scrub(l)}`).join('\n').slice(0, NOTE_TEXT);
        } catch {
          continue;
        }
        const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
        const was = state.notes[`${s.key}/${name}`];
        if (!was || was.hash !== hash || now.getTime() - Date.parse(was.at) > NOTE_RESEND_MS) notes.push({ note: { key: s.key, name, text }, hash, at: was?.at ?? '' });
      }
    } catch (err) {
      log(`director: ${s.key} left out of the beat: ${err.message}`);
    }
  }
  // A Director from before 0.16.0 refuses a field it does not know, and says no version: rules only to a newer one.
  if (!atLeast(state.directorVersion, '0.16.0')) for (const p of projects) delete p.rules;
  // When the last push was (D197): only to a Director from 0.16.1.
  if (!atLeast(state.directorVersion, '0.16.1')) for (const p of projects) delete p.rules?.push?.after;
  // Why the lead agent asks for the push sooner (D198): only to a Director from 0.17.0.
  if (!atLeast(state.directorVersion, '0.17.0')) for (const p of projects) delete p.rules?.push?.why;
  // The model and the longest run, for permits (D201): only to a Director from 0.19.0.
  if (!atLeast(state.directorVersion, '0.19.0')) for (const p of projects) { delete p.model; delete p.maxMinutes; }
  const sendQuota = quota && quota.readAt !== state.quotaReadAt;
  const sending = [];
  let size = 0;
  for (const b of boards.sort((x, y) => x.at.localeCompare(y.at))) {
    const n = JSON.stringify(b.board).length;
    if (size + n > BOARD_BYTES) continue;
    size += n;
    sending.push(b);
  }
  const notesSending = [];
  let noteSize = 0;
  for (const n of notes.sort((x, y) => x.at.localeCompare(y.at))) {
    if (noteSize + n.note.text.length > NOTE_BYTES || notesSending.length >= 20) continue;
    noteSize += n.note.text.length;
    notesSending.push(n);
  }
  // Results of the dashboard's orders whose quick report did not get through go with the beat (D191).
  state.orders ??= { done: {}, unsent: [] };
  const unsent = state.orders.unsent.slice(0, 50);
  // What waits for Telegram, when the Director has the bot (D202).
  const messages = takeMessages();
  // The order an echo tells of, for its two buttons (D206): only to a Director from 0.20.4; an older one gets the way
  // to change the dashboard's token in the text, as before.
  if (!atLeast(state.directorVersion, '0.20.4')) {
    for (const m of messages.items) if (m.order) { delete m.order; m.text = `${m.text}\n${t('order.notYou', {}, code)}`; }
  }
  const r = await call(link, '/v1/beat', { version: VERSION, at: now.toISOString(), language: code, quota: sendQuota ? quota : null, projects: projects.slice(0, 100), runs: runs.slice(0, 50),
    // Only when there is one: a Director from before 0.13.0 refuses a field it does not know.
    boards: sending.map((b) => b.board), ...(unsent.length ? { results: unsent } : {}), ...(messages.items.length ? { messages: messages.items } : {}),
    ...(notesSending.length ? { notes: notesSending.map((n) => n.note) } : {}) });
  const problem = r.error ?? (r.status >= 400 ? r.data.error : null);
  messages.settle(!problem);
  if (problem) {
    if (problem !== state.lastError) log(`director: ${problem}`);
    const status = r.status === 403 ? (/revoked/.test(problem) ? 'revoked' : 'pending') : state.status;
    // Silent for SILENT_MS while it decided: local mode, said once (D149).
    const local = state.mode === 'directing' && (!state.lastOk || now.getTime() - Date.parse(state.lastOk) > SILENT_MS);
    if (local && !state.local) log('director: no answer for 5 minutes: local mode, slots held at the 5-hour cap and the reserve, fill runs at most one every 2 hours');
    writeState({ ...state, status, lastError: problem, lastErrorAt: now.toISOString(), local: local || state.local === true });
    return { error: problem };
  }
  if (state.lastError || state.status !== 'approved') log('director: beat answered');
  const mode = r.data.mode === 'directing' ? 'directing' : 'observing';
  const telegram = r.data.telegram === true;
  if (telegram !== (state.telegram === true)) log(telegram ? 'director: Telegram is on the Director: this Mac\'s messages go with its beat, and its own bridge stays off' : 'director: Telegram is not on the Director: this Mac\'s own bridge, if set up, speaks again');
  if (mode !== (state.mode ?? 'observing')) log(mode === 'directing' ? 'director: directing this Mac: fill runs and slots on its permits' : 'director: only observing: this Mac keeps phase 1');
  else if (state.local && mode === 'directing') log('director: answering again: directed');
  for (const run of runs.slice(0, 50)) state.cursors[run.project] = Math.max(state.cursors[run.project] ?? 0, run.id);
  for (const b of sending) state.boards[b.board.key] = { hash: b.sum, at: now.toISOString() };
  for (const n of notesSending) state.notes[`${n.note.key}/${n.note.name}`] = { hash: n.hash, at: now.toISOString() };
  // A note no board names any more is forgotten.
  for (const k of Object.keys(state.notes)) if (!named.has(k)) delete state.notes[k];
  state.orders.unsent = state.orders.unsent.slice(unsent.length);
  // The dashboard's orders (D169, D191): run here under this Mac's own checks, then reported at once.
  if (Array.isArray(r.data.orders) && r.data.orders.length) {
    const results = runOrders(r.data.orders, { done: state.orders.done, env, now });
    for (const x of results) log(`director: order ${x.id} ${x.ok ? 'done' : 'not done'}: ${x.text}`);
    const sent = await call(link, '/v1/results', { results: results.slice(0, 50) });
    if (sent.error || sent.status >= 400) state.orders.unsent.push(...results);
  }
  // The Director's permits (D148): checked, then run as this Mac runs its own work.
  if (mode === 'directing' && Array.isArray(r.data.permits)) runPermits(r.data.permits, { env, now, log });
  // An order is remembered a day, so one given again is reported rather than run twice.
  const day = now.getTime() - 86_400_000;
  for (const [id, x] of Object.entries(state.orders.done)) if (Date.parse(x.at) < day) delete state.orders.done[id];
  writeState({ ...state, status: 'approved', lastOk: now.toISOString(), lastError: null, lastErrorAt: null, quotaReadAt: sendQuota ? quota.readAt : state.quotaReadAt,
    directorVersion: typeof r.data.version === 'string' ? r.data.version.slice(0, 20) : null, mode, local: false, telegram,
    // Kept for local mode (D149): the Director's settings, and its pace to show.
    settings: mode === 'directing' ? pick(r.data.settings, ['target', 'reserve', 'fiveHourCap']) : null,
    pace: mode === 'directing' ? pick(r.data.pace, ['verdict', 'why', 'target']) : null });
  return r.data;
}

// A text for Telegram leaves the Mac with no path, its lines kept.
const lines = (text, n) => String(text ?? '').split('\n').map((l) => scrub(l)).join('\n').slice(0, n);

// Up to 20 queued messages for the beat, as the Director takes them (D202): the project's key, the text, and a
// request's, a block's or a push's own fields, never a folder. `settle(sent)` drops them once the Director has them,
// or puts them back for the next beat.
function takeMessages() {
  const file = directorOutboxPath();
  const sending = `${file}.sending`;
  // A beat that died while sending left its batch: it goes first.
  if (!existsSync(sending) && existsSync(file)) renameSync(file, sending);
  const all = existsSync(sending) ? readFileSync(sending, 'utf8').split('\n').filter(Boolean) : [];
  const items = [];
  for (const line of all.slice(0, 20)) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    const request = m.request && Number.isInteger(m.request.id) ? { id: m.request.id, question: lines(m.request.question, 600), ...(m.request.options ? { options: lines(m.request.options, 600) } : {}), ...(m.request.recommendation ? { recommendation: lines(m.request.recommendation, 600) } : {}) } : null;
    const alert = m.alert && Number.isInteger(m.alert.id) ? { id: m.alert.id, actions: (m.alert.actions ?? []).slice(0, 10).map((a) => String(a).slice(0, 20)) } : null;
    const push = m.push && /^[0-9a-f]{12}$/.test(m.push.head ?? '') ? { head: m.push.head, branch: cut(m.push.branch, 60) } : null;
    const order = Number.isInteger(m.order) && m.order > 0 ? m.order : null;
    items.push({ at: String(m.at ?? '').slice(0, 40), ...(m.project ? { project: String(m.project).slice(0, 120) } : {}), text: lines(m.text, 1500), ...(request ? { request } : {}), ...(alert ? { alert } : {}), ...(push ? { push } : {}), ...(order ? { order } : {}) });
  }
  return {
    items,
    settle(sent) {
      if (!all.length) return;
      const left = sent ? all.slice(20) : all;
      rmSync(sending, { force: true });
      if (left.length) {
        // The ones still waiting go before those queued meanwhile.
        const later = existsSync(file) ? readFileSync(file, 'utf8') : '';
        writeFileSync(file, `${left.join('\n')}\n${later}`);
      }
    },
  };
}

const pick = (o, keys) => (o && typeof o === 'object' ? Object.fromEntries(keys.filter((k) => ['number', 'string'].includes(typeof o[k])).map((k) => [k, typeof o[k] === 'string' ? o[k].slice(0, 300) : o[k]])) : null);

const PERMIT = ['id', 'project', 'kind', 'model', 'maxMinutes', 'expiresAt'];
const MODELS = ['opus', 'sonnet', 'haiku'];

// Whether this Mac runs a permit (D148): the Director's signature was checked with the answer; here, that it names a
// project of this Mac (a slot of that project, or a project offered for fill runs), a model it may use, no longer a
// run than the project's own, that it has not expired and has no other field. Returns { dir, slot } or { why }.
export function checkPermit(p, { now = new Date(), projects = new Map(), filled = new Set() } = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { why: 'not a permit' };
  const fields = p.kind === 'slot' ? [...PERMIT, 'slot'] : PERMIT;
  const extra = Object.keys(p).find((k) => !fields.includes(k));
  if (extra) return { why: `a field it should not have: ${String(extra).slice(0, 40)}` };
  if (!Number.isInteger(p.id) || !['fill', 'slot'].includes(p.kind) || typeof p.project !== 'string' || typeof p.model !== 'string'
    || typeof p.maxMinutes !== 'number' || typeof p.expiresAt !== 'string' || (p.kind === 'slot' && typeof p.slot !== 'string')) return { why: 'a field missing or of the wrong kind' };
  const dir = projects.get(p.project);
  if (!dir) return { why: 'not a project of this Mac' };
  const { config } = heartbeatConfig(dir);
  const own = readMarker(dir).heartbeat?.model ?? 'opus';
  if (![...MODELS, own].includes(p.model)) return { why: `model ${p.model.slice(0, 40)} not allowed` };
  if (!(p.maxMinutes > 0) || p.maxMinutes > config.maxMinutes) return { why: `${p.maxMinutes} minutes, longer than the project's ${config.maxMinutes}` };
  if (!(Date.parse(p.expiresAt) > now.getTime())) return { why: 'expired' };
  if (p.kind === 'slot' && !config.slots.some((x) => x.name === p.slot)) return { why: `no slot ${p.slot.slice(0, 40)} in the project` };
  if (p.kind === 'fill' && !filled.has(real(dir))) return { why: 'not offered for fill runs (`jerome governor add`)' };
  return { dir, slot: p.kind === 'slot' ? p.slot : null };
}

// Each permit once: checked, kept with its folder for the run to find, and started apart from the watchdog. A fill run
// also meets this Mac's own reasons not to start one now (D176, D187).
function runPermits(permits, { env, now, log }) {
  const kept = readPermits();
  const projects = new Map(stores().filter((s) => !s.orphan && s.record?.path && existsSync(join(s.record.path, MARKER))).map((s) => [s.key, s.record.path]));
  const filled = new Set(governorSettings().projects.map(real));
  for (const p of permits.slice(0, 20)) {
    if (kept[p?.id]) continue;
    const ok = checkPermit(p, { now, projects, filled });
    const why = ok.why ?? (ok.slot ? (lockHolder(ok.dir) ? 'another heartbeat of the project is running' : null) : fillBlock(ok.dir, now));
    kept[p?.id ?? `bad-${now.getTime()}`] = { kind: p?.kind ?? null, slot: ok.slot ?? null, dir: ok.dir ?? null, model: p?.model ?? null, maxMinutes: p?.maxMinutes ?? null, at: now.toISOString(), dropped: why ?? null };
    writePermits(kept, now);
    if (why) {
      log(`director: permit ${String(p?.id).slice(0, 12)} dropped: ${why}`);
      continue;
    }
    log(`director: permit ${p.id}: ${ok.slot ? `slot ${ok.slot}` : 'fill run'} in ${basename(ok.dir)}`);
    launchRun(ok.dir, env, ok.slot ? ['heartbeat', 'run', ok.slot, ok.dir, '--permit', String(p.id)] : ['heartbeat', 'fill', ok.dir, '--permit', String(p.id)]);
  }
}

// Permits are remembered a day, so one given again is not run twice.
function writePermits(kept, now) {
  const day = now.getTime() - 86_400_000;
  const fresh = Object.fromEntries(Object.entries(kept).filter(([, x]) => Date.parse(x.at) > day));
  mkdirSync(dirname(permitsPath()), { recursive: true });
  writeFileSync(permitsPath(), JSON.stringify(fresh));
}

// A slot's run asks the Director before it starts (S4, 10 seconds at most): { go, permit } or { queued, why }, or
// { error } when it does not answer, and the run goes on as in local mode.
export async function askDirector(key, slot, env = process.env) {
  const link = readLink(env);
  if (!link) return { error: 'not connected' };
  const r = await call(link, '/v1/ask', { project: key, slot: String(slot).slice(0, 40) });
  if (r.error) return { error: r.error };
  if (r.status >= 400) return { error: r.data.error };
  if (r.data.go === false) return { queued: true, why: cut(r.data.why ?? 'no room now', 300) };
  return { go: true, permit: Number.isInteger(r.data.permit) ? r.data.permit : null };
}
