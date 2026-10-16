// Tests of `jerome projects` (D114): every project of the machine from the database registry, what needs the user
// first, databases left by projects that are gone, the page of `--view`, and the hint outside a project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'jerome-projects-')));
process.env.HOME = join(root, 'home');
process.env.XDG_DATA_HOME = join(root, 'data');
process.env.XDG_CONFIG_HOME = join(root, 'config');
process.env.CLAUDE_CONFIG_DIR = join(root, 'claude-config');
const { openDb } = await import('../src/db.js');
const { stores } = await import('../src/store.js');
const { readProjects, formatProjects, span } = await import('../src/projects.js');
const { startProjectsViewer } = await import('../src/view.js');
const { launchAgentsDir, jobLabel } = await import('../src/schedule.js');

const BIN = join(import.meta.dirname, '..', 'bin', 'jerome.js');
const HOUR = 3_600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
let viewer;

// A project with a database: its marker, then its runs as [status, reason, startedAt] heartbeats.
function project(name, { marker = {}, heartbeats = [], request = null, tokens = 0 } = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, '.jerome'), { recursive: true });
  writeFileSync(join(dir, '.jerome', 'project.json'), JSON.stringify({ schema: 'jerome.project/v1', ...marker }));
  const db = openDb(dir, { create: true });
  for (const [status, reason, at] of heartbeats) {
    db.prepare("INSERT INTO runs (kind, started_at, ended_at, status, reason) VALUES ('heartbeat', ?, ?, ?, ?)").run(at, at, status, reason);
  }
  if (tokens) db.prepare("INSERT INTO usage (request_id, agent, model, input, output, cache_read, at) VALUES ('u1', 'main', 'claude-opus-5-5', ?, 0, 0, ?)").run(tokens, ago(60_000));
  if (request) db.prepare('INSERT INTO requests (opened_at, question) VALUES (?, ?)').run(ago(HOUR), request);
  db.close();
  return dir;
}

before(async () => {
  project('calm', { heartbeats: [['done', 'main: a task', ago(HOUR)]] });
  // A lock or a limit pause clears by itself: not a reason to call the user.
  project('locked', { heartbeats: [['blocked', 'locked: another heartbeat of this project is running', ago(2 * HOUR)]] });
  project('paused', { heartbeats: [['blocked', 'project limit: today ≈$5.10 / $5 API (3.0M tokens), resets at midnight', ago(3 * HOUR)]] });
  project('waiting', { request: 'merge task/x: tests fail', heartbeats: [['blocked', 'locked: another heartbeat of this project is running', ago(HOUR)]] });
  project('dirty', { heartbeats: [['blocked', 'uncommitted changes (a.txt)', ago(HOUR)]] });
  project('capped', { heartbeats: [['stopped', 'token cap: 600,000 tokens over 500,000', ago(HOUR)]] });
  // A cap given for one run is a manual trial; a limit shows with the limits, and pauses heartbeats by itself.
  project('trial', { heartbeats: [['stopped', 'token cap: 168,021 tokens over 150,000 (this run; main 58k, developer 114k)', ago(4 * HOUR)]] });
  project('spent', { tokens: 1_000_000 });
  project('late', { marker: { heartbeat: { every: 'daily', hour: 9, minute: 0 } }, heartbeats: [['done', 'main: a task', ago(74 * HOUR)]] });
  // Scheduled long ago and never run: the job file's age stands for when.
  const never = project('never', { marker: { heartbeat: { every: 'hourly', minute: 15 } } });
  mkdirSync(launchAgentsDir(), { recursive: true });
  const plist = join(launchAgentsDir(), `${jobLabel(never)}.plist`);
  writeFileSync(plist, '<plist/>');
  utimesSync(plist, new Date(Date.now() - 5 * HOUR), new Date(Date.now() - 5 * HOUR));
  // A database behind this Jérôme's schema: listed, with what to do.
  const old = project('old');
  const db = openDb(old);
  db.exec('PRAGMA user_version = 1');
  db.close();
  // A project that is gone: its database is listed with doctor's hints, never removed.
  rmSync(project('gone'), { recursive: true });
  viewer = await startProjectsViewer({ token: 'secret-token' });
});

after(() => viewer?.server.close());

test('the projects that need the user come first, each with its reasons; a lock, a pause, a limit or a one-run cap is not one', () => {
  const p = readProjects();
  assert.equal(p.schema, 'jerome.projects/v1');
  const reasons = Object.fromEntries(p.projects.map((x) => [x.name, x.attention]));
  assert.deepEqual(reasons.calm, []);
  assert.deepEqual(reasons.locked, []);
  assert.deepEqual(reasons.paused, []);
  assert.deepEqual(reasons.waiting, ['1 open decision request: R1']);
  assert.deepEqual(reasons.dirty, ['heartbeat blocked: uncommitted changes (a.txt)']);
  assert.deepEqual(reasons.capped, ['heartbeat stopped: token cap: 600,000 tokens over 500,000']);
  assert.deepEqual(reasons.trial, []);
  assert.deepEqual(reasons.spent, []);
  assert.notEqual(p.projects.find((x) => x.name === 'spent').projectLimits.daily.level, 'ok', 'the limit is reached, and only shown');
  assert.deepEqual(reasons.late, ['no heartbeat for 3 days (scheduled every day at 09:00)']);
  assert.deepEqual(reasons.never, ['no heartbeat in the 5 hours since it was scheduled (every hour at :15)']);
  assert.match(reasons.old[0], /schema 1 of \d+: run `jerome doctor`/);
  const order = p.projects.map((x) => x.name);
  const firstCalm = Math.min(...['calm', 'locked', 'paused', 'trial', 'spent'].map((name) => order.indexOf(name)));
  for (const name of ['waiting', 'dirty', 'capped', 'late', 'never', 'old']) assert.ok(order.indexOf(name) < firstCalm, `${name} comes before the projects that need nothing`);
  // Among the rest, the latest activity first.
  assert.deepEqual(order.slice(firstCalm), ['calm', 'locked', 'paused', 'trial', 'spent']);
  assert.deepEqual(p.orphans.map((o) => o.key.replace(/-\w+$/, '')), ['gone']);
  assert.equal(stores().length, 12, 'nothing is removed');
});

test('a row carries the last heartbeat, the requests and the 7-day usage', () => {
  const late = readProjects().projects.find((x) => x.name === 'late');
  assert.equal(late.lastHeartbeat.status, 'done');
  assert.deepEqual(late.schedule, { every: 'daily', text: 'every day at 09:00' });
  assert.deepEqual(late.week, { tokens: 0, apiUsd: 0, unpriced: false });
  assert.equal(late.areasImplicit, true);
});

test('the text shows the reasons, a table and the databases without a project', () => {
  const text = formatProjects(readProjects());
  assert.match(text, /^jerome projects · 11 projects, 6 need you/);
  assert.match(text, /! dirty {2}\S+\/dirty\n {4}heartbeat blocked: uncommitted changes \(a\.txt\)/);
  assert.match(text, /PROJECT +AREAS +REQ +LAST HEARTBEAT +7 DAYS +FOLDER/);
  assert.match(text, / {2}calm +— +0 +1 hour ago done/);
  assert.match(text, /A database belongs to a folder that no longer holds a Jérôme project:\n {2}gone-\w+ \(was \S+\/gone\), 0 runs\n {2}If the project moved/);
  assert.equal(span(90 * 60_000), '1 hour');
  assert.equal(span(30 * HOUR), '30 hours');
});

function get(path, { token = 'secret-token' } = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: viewer.port, path: `${path}${token === null ? '' : `?t=${token}`}` }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('--view serves the overview and each project\'s viewer under /p/<key>/, by registry key only', async () => {
  assert.equal((await get('/', { token: null })).status, 403);
  const page = await get('/');
  assert.match(page.body, /<title>Jérôme projects<\/title>/);
  assert.match(page.body, /<style>[\s\S]*prefers-color-scheme: dark/, 'the stylesheet is put inline');
  assert.doesNotMatch(page.body, /innerHTML|insertAdjacentHTML|outerHTML/);
  const data = JSON.parse((await get('/api/projects')).body);
  assert.equal(data.projects.length, 11);
  const calm = data.projects.find((x) => x.name === 'calm');
  const redirect = await get(`/p/${calm.key}`);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, `/p/${calm.key}/?t=secret-token`);
  assert.match((await get(`/p/${calm.key}/`)).body, /<title>Jérôme viewer<\/title>[\s\S]*jerome projects/);
  const state = JSON.parse((await get(`/p/${calm.key}/api/state`)).body);
  assert.equal(state.project, 'calm');
  assert.equal(state.lastHeartbeat.status, 'done');
  assert.equal((await get(`/p/${calm.key}/api/state`, { token: null })).status, 403);
  assert.equal((await get(`/p/${data.orphans[0].key}/`)).status, 404, 'a database without a project is not served');
  assert.equal((await get('/p/..%2F..%2Fetc/')).status, 404);
});

test('state and view outside a project point to jerome projects; projects takes no folder', () => {
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env: process.env });
  for (const command of ['state', 'view']) {
    const r = run(command, root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not a Jérôme project[\s\S]*All the projects of this machine: `jerome projects`\./);
  }
  assert.equal(run('projects', root).status, 2);
  assert.equal(run('projects', '--json', '--view').status, 2);
  assert.equal(run('projects', '--port', '8000').status, 2);
  const json = run('projects', '--json');
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).projects.length, 11);
});
