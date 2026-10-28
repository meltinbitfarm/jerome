// The Director's dashboard (D151): read-only, on the Director's own address. The page holds no data and no secret;
// its data comes from /api/overview, which needs the dashboard's token, given in the URL's fragment (never sent to
// the server by the browser, never in a log) and passed by the page in a header. Nothing here writes: the only
// methods answered are GET. A strict Content-Security-Policy lets only the page's own script and style run, and the
// page sets every text with textContent.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pace, GOVERNOR_DEFAULTS } from './pacing.js';
import { VERSION } from './template.js';
import { scrub } from './scrub.js';

const PAGE = join(import.meta.dirname, '..', 'viewer', 'director.html');
const STYLE = join(import.meta.dirname, '..', 'viewer', 'style.css');
const WEEK_MS = 7 * 86_400_000;
// A Mac whose last beat is older than this is shown as unreachable: it beats every minute.
export const UNREACHABLE_MIN = 3;
const RUNS = 200;

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
      .replace('<script>', `<script nonce="${nonce}">`);
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
  const machines = db.prepare("SELECT id, name, status, last_beat, version FROM machines WHERE status != 'revoked' ORDER BY name").all();
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
  const projects = db.prepare('SELECT machine, key, data FROM projects ORDER BY name').all().filter((p) => names.has(p.machine)).map((p) => {
    const data = parse(p.data);
    const mine = db.prepare('SELECT data FROM runs WHERE machine = ? AND project = ? AND ended_at >= ?').all(p.machine, p.key, since).map((r) => parse(r.data));
    const costs = mine.map((r) => r.quota?.after?.seven_day - r.quota?.before?.seven_day).filter((d) => Number.isFinite(d) && d >= 0);
    return {
      ...data,
      machine: names.get(p.machine),
      runs7d: mine.length,
      fill7d: mine.filter((r) => r.kind === 'fill').length,
      cost: costs.length ? { points: Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10) / 10, runs: costs.length } : null,
    };
  });
  return {
    schema: 'jerome.director.overview/v1',
    at: now.toISOString(),
    version: VERSION,
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
