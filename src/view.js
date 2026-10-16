// `jerome view [dir]`: the local read-only viewer (D11, D64-D69). A node:http server on 127.0.0.1 serves one page
// and two JSON endpoints; every request must carry the random token of this run, and come for localhost, so neither
// a web page nor another user of the machine can read the data. Nothing is ever written (D65).
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { MARKER } from './template.js';
import { openDb, dbPath } from './db.js';
import { readState } from './state.js';
import { readAccount, accountPath } from './account.js';
import { findTranscript, delegations, leadCalls } from './delegations.js';
import { PRICES_DATE } from './models.js';
import { notProjectMessage, STATE } from './paths.js';

const PAGE = join(import.meta.dirname, '..', 'viewer', 'index.html');
const RUNS = 50;

export async function view(dirArg, { port = 0, open = true } = {}) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(notProjectMessage(dir));
    return 1;
  }
  if (!existsSync(dbPath(dir))) {
    console.error(`The project database is missing: run \`jerome doctor\` to create it.`);
    return 1;
  }
  let viewer;
  try {
    viewer = await startViewer(dir, { port });
  } catch (err) {
    console.error(`Cannot start the viewer: ${err.message}`);
    return 1;
  }
  console.log(`Jérôme viewer for ${dir}\n${viewer.url}\nRead-only. Press Ctrl+C to stop.`);
  if (open) openBrowser(viewer.url);
  await new Promise((done) => {
    const stop = () => viewer.server.close(() => done());
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    spawn(command, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // The URL is printed anyway.
  }
}

export function startViewer(dir, { port = 0, token = randomBytes(18).toString('base64url') } = {}) {
  const server = createServer((req, res) => {
    try {
      handle(dir, token, server, req, res);
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      done({ server, token, port: actual, url: `http://127.0.0.1:${actual}/?t=${token}` });
    });
  });
}

function handle(dir, token, server, req, res) {
  const { port } = server.address();
  const host = String(req.headers.host ?? '');
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: 'forbidden host' });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const given = Buffer.from(url.searchParams.get('t') ?? '');
  const expected = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return send(res, 403, { error: 'missing or wrong token' });
  if (req.method !== 'GET') return send(res, 405, { error: 'read-only' });

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    return res.end(readFileSync(PAGE));
  }
  if (url.pathname === '/api/state') {
    const tag = etag(dir, token);
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, { etag: tag });
      return res.end();
    }
    const state = readState(dir, { runs: RUNS, readOnly: true });
    return send(res, 200, { ...state, pricesDate: PRICES_DATE }, { etag: tag });
  }
  const run = url.pathname.match(/^\/api\/runs\/(\d+)$/);
  if (run) return send(res, 200, runDetail(dir, Number(run[1])));
  return send(res, 404, { error: 'not found' });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', ...headers });
  res.end(JSON.stringify(body));
}

// Changes whenever something the page shows changes (D68): new events, runs or usage, or a new account reading;
// and at every start of the viewer, through its token, so a browser never keeps what an older Jérôme computed.
function etag(dir, token) {
  const db = openDb(dir, { readOnly: true, migrate: false });
  try {
    const row = db.prepare(`SELECT (SELECT coalesce(max(id), 0) FROM events) e, (SELECT count(*) FROM runs) r,
      (SELECT coalesce(max(status || ended_at), '') FROM runs) s, (SELECT coalesce(max(at), '') FROM usage) u,
      (SELECT count(*) FROM requests WHERE status = 'open') q, (SELECT count(area) FROM runs) a`).get();
    let account = '';
    try {
      account = JSON.stringify(readAccount().windows);
    } catch {
      // An unreadable account file only means no windows.
    }
    const agents = existsSync(join(dir, '.claude', 'agents')) ? String(statSync(join(dir, '.claude', 'agents')).mtimeMs) : '';
    const areas = existsSync(join(dir, STATE.areas)) ? String(statSync(join(dir, STATE.areas)).mtimeMs) : '';
    const day = new Date().toDateString();
    return `"${createHash('sha256').update(JSON.stringify([row, account, agents, areas, day, accountPath(), token])).digest('base64url').slice(0, 16)}"`;
  } finally {
    db.close();
  }
}

// One run (D67): its usage per agent, its events, and the delegations read now from the transcript.
function runDetail(dir, id) {
  const db = openDb(dir, { readOnly: true, migrate: false });
  let run;
  let usage;
  let events;
  try {
    run = db.prepare('SELECT id, session_id, kind, status, started_at, ended_at, reason FROM runs WHERE id = ?').get(id);
    if (!run) return { error: 'no such run' };
    usage = db.prepare(`SELECT agent, model, count(*) calls, sum(input + output + cache_read + cache_write_5m + cache_write_1h) tokens
      FROM usage WHERE run_id = ? GROUP BY agent, model ORDER BY tokens DESC`).all(id).map((r) => ({ ...r }));
    events = db.prepare("SELECT at, kind, agent, data FROM events WHERE run_id = ? AND kind IN ('blocked', 'error') ORDER BY id").all(id)
      .map((e) => ({ at: e.at, kind: e.kind, agent: e.agent, data: safeJson(e.data) }));
  } finally {
    db.close();
  }
  const transcript = run.kind === 'service' ? null : findTranscript(run.session_id);
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    usage,
    events,
    transcript: transcript ? 'available' : 'unavailable',
    delegations: transcript ? delegations(transcript, run.session_id) : [],
    calls: transcript ? leadCalls(transcript) : [],
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
