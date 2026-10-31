// The Director's dashboard (D151), on the Director's own address. The page holds no data and no secret; its data
// comes from /api/overview, which needs the dashboard's token, given in the URL's fragment (never sent to the server
// by the browser, never in a log) and passed by the page in a header. A strict Content-Security-Policy lets only the
// page's own script and style run, and the page sets every text with textContent.
//
// Its one write is an order for a Mac (D169, D191): an answer to an open request, a note for a project, or one of the
// actions a block offers. The Director only keeps it; the Mac takes it with its next beat and checks it again under
// its own rules. Whoever took the dashboard could do no more than that, and the Mac tells the user on Telegram.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pace, GOVERNOR_DEFAULTS } from './pacing.js';
import { VERSION } from './template.js';
import { scrub } from './scrub.js';
import { blockMessage, howLong, lasting } from './blocks.js';
import { LANGUAGES, t } from './i18n.js';
import { optionList } from './options.js';
import { actionsFor, ACTIONS } from './unblock.js';
import { GROUPS } from './limits.js';

const PAGE = join(import.meta.dirname, '..', 'viewer', 'director.html');
const STYLE = join(import.meta.dirname, '..', 'viewer', 'style.css');
const BOARD_SCRIPT = join(import.meta.dirname, '..', 'viewer', 'board.js');
const ICON = join(import.meta.dirname, '..', 'viewer', 'director-icon.png');
const WEEK_MS = 7 * 86_400_000;
// A Mac whose last beat is older than this is shown as unreachable: it beats every minute.
export const UNREACHABLE_MIN = 3;
const RUNS = 200;
// An order's body, and the longest text a reply or a note may have.
export const ORDER_BODY = 8 * 1024;
const ORDER_TEXT = 2000;
const ORDERS_PER_MIN = 20;

// Whether a request carries the dashboard's token.
function authorized(req, token) {
  const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const expected = Buffer.from(String(token ?? ''));
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}

// Answers a GET: the page, or the overview with the token. Returns false for anything else, which is not the
// dashboard's.
export function serveDashboard(req, res, { db, token, now = new Date() }) {
  if (req.method !== 'GET') return false;
  const path = new URL(req.url, 'http://director').pathname;
  if (path === '/') {
    const nonce = randomBytes(16).toString('base64');
    const html = readFileSync(PAGE, 'utf8')
      .replace('<link rel="stylesheet" href="style.css">', () => `<style nonce="${nonce}">\n${readFileSync(STYLE, 'utf8')}</style>`)
      .replace('<script>', `<script nonce="${nonce}">`)
      .replace('<script src="board.js"></script>', () => `<script nonce="${nonce}">\n${readFileSync(BOARD_SCRIPT, 'utf8')}</script>`);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
    res.end(html);
    return true;
  }
  // The icon for a phone's home screen or a browser's tab: no data in it, so no token.
  if (['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.ico', '/icon.png'].includes(path)) {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400', 'x-content-type-options': 'nosniff' });
    res.end(readFileSync(ICON));
    return true;
  }
  if (path === '/api/overview') {
    if (!authorized(req, token)) {
      json(res, 403, { error: 'missing or wrong token: open the address `jerome director dashboard` prints' });
      return true;
    }
    json(res, 200, overview(db, now));
    return true;
  }
  json(res, 404, { error: 'not found' });
  return true;
}

// An order from the dashboard (D191), checked against what the Mac last said: the project is one of its own, the
// request or the block is open, the action is one the block offers, the option one of the request's. A choice is
// sent as its text, so the Mac answers with exactly what the user saw. Returns { status, body }.
export function takeOrder({ db, token, headers, body, now = new Date() }) {
  if (!authorized({ headers }, token)) return { status: 403, body: { error: 'missing or wrong token' } };
  if (!/^application\/json\b/.test(String(headers['content-type'] ?? ''))) return { status: 415, body: { error: 'JSON only' } };
  let o;
  try {
    o = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: 'the body is not JSON' } };
  }
  const bad = (error) => ({ status: 400, body: { error } });
  if (typeof o !== 'object' || o === null) return bad('the body is not an order');
  const row = typeof o.machine === 'string' && typeof o.project === 'string'
    ? db.prepare("SELECT p.data FROM projects p JOIN machines m ON m.id = p.machine WHERE p.machine = ? AND p.key = ? AND m.status = 'approved'").get(o.machine, o.project) : null;
  if (!row) return bad('no such project');
  const project = JSON.parse(row.data);
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (text.length > ORDER_TEXT) return bad(`at most ${ORDER_TEXT} characters`);
  let order;
  if (o.kind === 'answer') {
    const request = (project.requests ?? []).find((r) => r.id === o.ref);
    if (!request) return bad('that question is not open any more');
    const choice = Number.isInteger(o.choice) ? optionList(request.options)[o.choice] : null;
    if (Number.isInteger(o.choice) && !choice) return bad('no such option');
    if (!choice && !text) return bad('an answer needs an option or a text');
    order = { kind: 'answer', ref: request.id, action: null, text: choice ?? text };
  } else if (o.kind === 'note') {
    if (!text) return bad('a note needs a text');
    order = { kind: 'note', ref: null, action: null, text };
  } else if (o.kind === 'action') {
    const alert = (project.alerts ?? []).find((a) => a.id === o.ref);
    if (!alert) return bad('that block is closed');
    if (!ACTIONS.includes(o.action) || !actionsFor(alert.reason).includes(o.action)) return bad('that block does not offer this action');
    order = { kind: 'action', ref: alert.id, action: o.action, text: null };
  } else if (o.kind === 'push') {
    // The push the Mac asked (D196): only for the head it asked about, and only go or not now.
    const push = project.rules?.push;
    if (!push || push.head !== o.head) return bad('that push is not asked any more');
    if (!['go', 'no'].includes(o.action)) return bad('a push is go or no');
    order = { kind: 'push', ref: null, action: o.action, text: push.head };
  } else if (o.kind === 'lock') {
    // Locking again is the safe way (D196); unlocking is done only at the Mac.
    if (!GROUPS[o.group] || !(project.rules?.unlocked ?? []).includes(o.group)) return bad('that is not unlocked');
    order = { kind: 'lock', ref: null, action: null, text: o.group };
  } else return bad('kind is answer, note, action, push or lock');
  const at = now.toISOString();
  if (db.prepare('SELECT count(*) n FROM orders WHERE created_at > ?').get(new Date(now.getTime() - 60_000).toISOString()).n >= ORDERS_PER_MIN) {
    return { status: 429, body: { error: 'too many orders: wait a minute' } };
  }
  // The same answer or action twice, before the Mac took the first, is one order.
  if (order.kind !== 'note' && db.prepare("SELECT 1 FROM orders WHERE machine = ? AND project = ? AND kind = ? AND coalesce(ref, -1) = coalesce(?, -1) AND (ref IS NOT NULL OR text = ?) AND status = 'pending'").get(o.machine, o.project, order.kind, order.ref, order.text)) {
    return { status: 409, body: { error: 'already sent: the Mac takes it within a minute' } };
  }
  const id = Number(db.prepare('INSERT INTO orders (machine, project, kind, ref, action, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(o.machine, o.project, order.kind, order.ref, order.action, order.text, at).lastInsertRowid);
  return { status: 201, body: { id, kind: order.kind, project: project.name } };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

// Stored data as the page gets it: every text scrubbed again, for what Macs before 0.5.2 sent.
const parse = (text) => {
  try {
    return JSON.parse(text, (key, value) => (typeof value === 'string' && ['reason', 'question'].includes(key) ? scrub(value) : value));
  } catch {
    return null;
  }
};

// Everything the page shows, from the Director's database: the quota and its week, the Macs, their projects, the
// runs, and the past weeks.
export function overview(db, now = new Date()) {
  const machines = db.prepare("SELECT id, name, status, last_beat, version, language FROM machines WHERE status != 'revoked' ORDER BY name").all();
  // The user's language (D163): the one of the Mac that beat last, as it says it.
  const spoken = machines.filter((m) => m.status === 'approved' && LANGUAGES[m.language]).sort((a, b) => String(b.last_beat).localeCompare(String(a.last_beat)))[0]?.language ?? 'en';
  const names = new Map(machines.map((m) => [m.id, m.name]));
  const readings = db.prepare('SELECT machine, read_at, data FROM readings ORDER BY read_at').all().map((r) => ({ machine: r.machine, at: r.read_at, ...parse(r.data) }));
  const latest = readings.at(-1) ?? null;
  const week = latest?.windows?.seven_day;
  const resetsAt = week?.resetsAt ? week.resetsAt * 1000 : null;
  const settings = GOVERNOR_DEFAULTS;
  const quota = latest ? {
    readAt: latest.at,
    by: names.get(latest.machine) ?? null,
    windows: latest.windows,
    scoped: latest.scoped ?? [],
    breakdown: latest.breakdown ?? [],
    pace: pace({ windows: latest.windows, readAt: new Date(latest.at), scoped: latest.scoped ?? [], settings, now }),
    settings,
    weekStart: resetsAt ? new Date(resetsAt - WEEK_MS).toISOString() : null,
    resetsAt: resetsAt ? new Date(resetsAt).toISOString() : null,
    // This week's readings, for the chart: the 7-day and 5-hour points at each reading.
    series: resetsAt ? readings.filter((r) => r.windows?.seven_day?.resetsAt === week.resetsAt)
      .map((r) => ({ at: r.at, seven: r.windows.seven_day.used, five: r.windows.five_hour?.used ?? null })) : [],
  } : null;
  // Each past week, by its reset: the highest reading seen before it.
  const weeks = new Map();
  for (const r of readings) {
    const w = r.windows?.seven_day;
    if (!w?.resetsAt || w.resetsAt * 1000 > now.getTime()) continue;
    weeks.set(w.resetsAt, Math.max(weeks.get(w.resetsAt) ?? 0, w.used));
  }

  const runs = db.prepare('SELECT machine, project, data FROM runs ORDER BY ended_at DESC LIMIT ?').all(RUNS)
    .map((r) => ({ machine: names.get(r.machine) ?? null, ...parse(r.data) }));
  const since = new Date(now.getTime() - WEEK_MS).toISOString();
  // The requests answered and the blocks acted on from here lately (D191): gone from the page at once, without waiting
  // for the Mac's next beat to say they are closed.
  const handled = new Set(db.prepare("SELECT machine, project, kind, ref FROM orders WHERE status IN ('pending', 'done') AND ref IS NOT NULL AND created_at > ?")
    .all(new Date(now.getTime() - 15 * 60_000).toISOString()).map((o) => `${o.machine}/${o.project}/${o.kind}/${o.ref}`));
  const recent = db.prepare("SELECT machine, project, kind, text FROM orders WHERE status IN ('pending', 'done') AND kind IN ('push', 'lock') AND created_at > ?")
    .all(new Date(now.getTime() - 15 * 60_000).toISOString());
  const pushed = new Set(recent.filter((o) => o.kind === 'push').map((o) => `${o.machine}/${o.project}/${o.text}`));
  const locked = new Set(recent.filter((o) => o.kind === 'lock').map((o) => `${o.machine}/${o.project}/${o.text}`));
  const projects = db.prepare('SELECT machine, key, data FROM projects ORDER BY name').all().filter((p) => names.has(p.machine)).map((p) => {
    const data = parse(p.data);
    data.requests = (data.requests ?? []).filter((r) => !handled.has(`${p.machine}/${p.key}/answer/${r.id}`));
    data.alerts = (data.alerts ?? []).filter((a) => !handled.has(`${p.machine}/${p.key}/action/${a.id}`));
    // The push answered and the groups locked from here lately (D196), gone at once too.
    if (data.rules?.push && pushed.has(`${p.machine}/${p.key}/${data.rules.push.head}`)) delete data.rules.push;
    if (data.rules) data.rules.unlocked = data.rules.unlocked.filter((g) => !locked.has(`${p.machine}/${p.key}/${g}`));
    const mine = db.prepare('SELECT data FROM runs WHERE machine = ? AND project = ? AND ended_at >= ?').all(p.machine, p.key, since).map((r) => parse(r.data));
    // The last work done: a heartbeat that stopped is a block, told apart, never "the last work".
    const done = db.prepare("SELECT data FROM runs WHERE machine = ? AND project = ? AND json_extract(data, '$.status') = 'done' ORDER BY ended_at DESC LIMIT 1").get(p.machine, p.key);
    const lastDone = done ? parse(done.data) : null;
    const costs = mine.map((r) => r.quota?.after?.seven_day - r.quota?.before?.seven_day).filter((d) => Number.isFinite(d) && d >= 0);
    // Each block as the user reads it (D160, D161): a sentence, how long, and whether it has lasted enough to need them.
    const blocks = (data.alerts ?? []).map((a) => {
      const alert = { reason: a.reason, count: a.count ?? 1, openedAt: a.openedAt ?? now.toISOString() };
      // The actions it offers (D166), named in the user's language, for the dashboard's buttons (D191).
      const actions = actionsFor(a.reason).map((name) => ({ name, label: t(`action.${name}`, {}, spoken) }));
      return { id: a.id, text: blockMessage(a.reason, spoken), since: howLong(alert, now, spoken), lasting: lasting(alert, now), actions };
    });
    // The project's board (D177), as its Mac last sent it.
    const board = parse(db.prepare('SELECT data FROM boards WHERE machine = ? AND key = ?').get(p.machine, p.key)?.data ?? 'null');
    const state = data.running ? 'running' : blocks.some((b) => b.lasting) ? 'stuck' : blocks.length ? 'retrying'
      : (data.requests ?? []).length ? 'asking' : data.overLimit ? 'paused' : 'idle';
    return {
      ...data,
      // The groups unlocked here, named in the user's language, each with its Lock button (D196).
      unlocked: (data.rules?.unlocked ?? []).filter((g) => GROUPS[g]).map((g) => ({ name: g, label: t(`group.${g}`, {}, spoken) })),
      blocks,
      state,
      // The last work in plain words when the board has it (D177), else as the runner wrote it.
      lastDone: lastDone ? { at: lastDone.endedAt ?? lastDone.startedAt, reason: board?.last?.at === lastDone.endedAt ? board.last.text : lastDone.reason, plain: board?.last?.at === lastDone.endedAt } : null,
      board,
      machine: names.get(p.machine),
      machineCode: p.machine,
      runs7d: mine.length,
      fill7d: mine.filter((r) => r.kind === 'fill').length,
      cost: costs.length ? { points: Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10) / 10, runs: costs.length } : null,
    };
  });
  return {
    schema: 'jerome.director.overview/v1',
    at: now.toISOString(),
    version: VERSION,
    language: spoken,
    // What waits for the user, first: the open decision requests, then the blocks that have lasted.
    attention: [
      ...projects.flatMap((p) => (p.requests ?? []).map((r) => ({ kind: 'request', project: p.name, key: p.key, machine: p.machine, machineCode: p.machineCode, id: r.id,
        question: r.question, options: r.options ?? null, choices: optionList(r.options), recommendation: r.recommendation ?? null }))),
      // The push the Mac asked on Telegram too (D196), with the same two choices.
      ...projects.filter((p) => p.rules?.push).map((p) => ({ kind: 'push', project: p.name, key: p.key, machine: p.machine, machineCode: p.machineCode,
        head: p.rules.push.head, branch: p.rules.push.branch, count: p.rules.push.count, subjects: p.rules.push.subjects,
        text: t('push.ask', { count: p.rules.push.count, branch: p.rules.push.branch, after: p.rules.push.after ?? null, subjects: p.rules.push.subjects.map((x) => `• ${x}`).join('\n') }, spoken),
        choices: [{ name: 'go', label: t('push.go', { branch: p.rules.push.branch }, spoken) }, { name: 'no', label: t('push.no', {}, spoken) }] })),
      ...projects.flatMap((p) => p.blocks.filter((b) => b.lasting).map((b) => ({ kind: 'block', project: p.name, key: p.key, machine: p.machine, machineCode: p.machineCode, id: b.id,
        text: b.text, since: b.since, actions: b.actions }))),
    ],
    // The dashboard's orders of the last day (D191), newest first, with what the Mac did.
    orders: db.prepare('SELECT o.*, m.name machine_name FROM orders o JOIN machines m ON m.id = o.machine WHERE o.created_at > ? ORDER BY o.id DESC LIMIT 30')
      .all(new Date(now.getTime() - 86_400_000).toISOString()).map((o) => ({
        id: o.id, kind: o.kind, ref: o.ref, action: o.action, text: o.text,
        actionLabel: o.kind === 'push' ? t(o.action === 'go' ? 'push.yes' : 'push.no', {}, spoken) : o.kind === 'lock' ? t('rules.lockOne', { group: o.text }, spoken) : o.action ? t(`action.${o.action}`, {}, spoken) : null,
        project: projects.find((p) => p.machineCode === o.machine && p.key === o.project)?.name ?? o.project, machine: o.machine_name,
        status: o.status, result: o.result ? scrub(o.result) : null, createdAt: o.created_at, doneAt: o.done_at,
      })),
    quota,
    machines: machines.map((m) => ({
      name: m.name,
      code: m.id,
      status: m.status,
      lastBeat: m.last_beat,
      version: m.version,
      reachable: Boolean(m.last_beat) && now.getTime() - Date.parse(m.last_beat) <= UNREACHABLE_MIN * 60_000,
      projects: projects.filter((p) => p.machine === m.name).length,
      running: projects.filter((p) => p.machine === m.name && p.running).length,
    })),
    projects,
    runs,
    weeks: [...weeks].sort((a, b) => b[0] - a[0]).slice(0, 12).map(([reset, used]) => ({ resetAt: new Date(reset * 1000).toISOString(), used })),
  };
}
