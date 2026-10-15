// Tests of the read-only viewer (phase 7): access, the state it serves, the delegations read from transcripts,
// and that nothing is written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = mkdtempSync(join(tmpdir(), 'jerome-view-'));
process.env.CLAUDE_CONFIG_DIR = join(root, 'claude-config');
process.env.XDG_CONFIG_HOME = join(root, 'config');
const { openDb } = await import('../src/db.js');
const { startViewer } = await import('../src/view.js');
const { readState } = await import('../src/state.js');

const dir = join(root, 'demo');
const SESSION = 'sess-1';
let viewer;

const assistant = (content, extra = {}) => `${JSON.stringify({ type: 'assistant', timestamp: '2026-10-15T10:00:00Z', message: { content }, ...extra })}\n`;

before(async () => {
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.jerome'), '');
  writeFileSync(join(dir, '.claude', 'agents', 'developer.md'), '---\nname: developer\ndescription: Code.\ntools: Read, Edit\nmodel: opus\nomitClaudeMd: true\n---\nWrite code.\n');
  const db = openDb(dir, { create: true });
  const now = new Date().toISOString();
  db.prepare("INSERT INTO runs (id, session_id, kind, started_at, ended_at, status) VALUES (1, ?, 'interactive', ?, ?, 'done')").run(SESSION, now, now);
  db.prepare("INSERT INTO runs (id, kind, started_at, status) VALUES (2, 'service', ?, 'done')").run(now);
  const usage = db.prepare("INSERT INTO usage (request_id, run_id, agent, model, input, output, cache_read, at) VALUES (?, 1, ?, ?, 10, 100, 1000, ?)");
  usage.run('r1', 'main', 'claude-opus-5-5', now);
  usage.run('r2', 'developer', 'claude-opus-5-5', now);
  usage.run('r3', 'general-purpose', 'claude-sonnet-5-5', now);
  db.prepare("INSERT INTO events (run_id, at, kind, agent, data) VALUES (1, ?, 'blocked', 'main', ?)").run(now, JSON.stringify({ subcommands: ['add', 'commit'], segments: 2, ms: 20 }));
  db.prepare("INSERT INTO events (run_id, at, kind, agent, data) VALUES (1, ?, 'subagent-stop', 'developer', ?)").run(now, JSON.stringify({ words: 175, ms: 20 }));
  db.prepare("INSERT INTO requests (run_id, opened_at, question) VALUES (1, ?, 'merge task/x: tests fail')").run(now);
  db.close();

  const projects = join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-demo');
  mkdirSync(join(projects, SESSION, 'subagents'), { recursive: true });
  writeFileSync(join(projects, `${SESSION}.jsonl`),
    assistant([{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'developer', description: 'Fix it', prompt: 'Fix <b>this</b> in src/a.js' } }]));
  writeFileSync(join(projects, SESSION, 'subagents', 'agent-x1.meta.json'), JSON.stringify({ agentType: 'developer', description: 'Fix it', toolUseId: 'tu1', requestShape: 'background' }));
  writeFileSync(join(projects, SESSION, 'subagents', 'agent-x1.jsonl'),
    `${JSON.stringify({ type: 'user', message: { content: 'Fix <b>this</b> in src/a.js' } })}\n`
    + assistant([{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'Fixed in src/a.js, tests pass.' } }]));
  mkdirSync(join(process.env.XDG_CONFIG_HOME, 'jerome'), { recursive: true });
  writeFileSync(join(process.env.XDG_CONFIG_HOME, 'jerome', 'account.json'), JSON.stringify({
    schema: 'jerome.account/v1', windows: { seven_day: { used: 20, resetsAt: 1, readAt: now, source: 'statusline' } }, limits: { seven_day: 70 },
  }));
  viewer = await startViewer(dir, { token: 'secret-token' });
});

after(() => viewer?.server.close());

function get(path, { host, token = 'secret-token', method = 'GET', headers = {} } = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: viewer.port, method, path: `${path}${token === null ? '' : `?t=${token}`}`,
      headers: { host: host ?? `127.0.0.1:${viewer.port}`, ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

const fingerprint = () => createHash('sha256').update(readFileSync(join(dir, '.jerome.db'))).digest('hex');

test('the viewer listens on 127.0.0.1 and refuses requests without the token, from another host, or that write', async () => {
  assert.match(viewer.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=secret-token$/);
  assert.equal((await get('/', { token: null })).status, 403);
  assert.equal((await get('/', { token: 'wrong-token!' })).status, 403);
  assert.equal((await get('/api/state', { host: 'evil.example:80' })).status, 403);
  assert.equal((await get('/api/state', { method: 'POST' })).status, 405);
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>Jérôme viewer<\/title>/);
});

test('/api/state serves the state with the team, the thresholds and room for project limits, and answers 304 when unchanged', async () => {
  const before = fingerprint();
  const r = await get('/api/state');
  assert.equal(r.status, 200);
  const s = JSON.parse(r.body);
  assert.equal(s.schema, 'jerome.state/v1');
  assert.deepEqual(s.team.lead.models, ['claude-opus-5-5']);
  assert.deepEqual(s.team.subagents.map((a) => [a.agent, a.source, a.model]), [['developer', 'project', 'opus'], ['general-purpose', 'built-in', null]]);
  assert.deepEqual(s.limits, { seven_day: 70 });
  assert.equal(s.windows.seven_day.used, 20);
  assert.equal(s.projectLimits, null);
  assert.deepEqual(Object.keys(s.byModel), ['today', 'week', 'month']);
  assert.equal(s.runs.length, 2);
  assert.deepEqual(s.replies.map((x) => [x.agent, x.max, x.over]), [['developer', 175, 1]]);
  assert.equal(s.pricesDate, '2026-10-15');
  const again = await get('/api/state', { headers: { 'if-none-match': r.headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(fingerprint(), before, 'the viewer never writes the database');
});

test('a run shows its delegations, read now from the transcripts, with the refused chains', async () => {
  const r = JSON.parse((await get('/api/runs/1')).body);
  assert.equal(r.transcript, 'available');
  assert.equal(r.delegations.length, 1);
  const [d] = r.delegations;
  assert.equal(d.agentType, 'developer');
  assert.equal(d.background, true);
  assert.equal(d.task, 'Fix <b>this</b> in src/a.js');
  assert.equal(d.reply, 'Fixed in src/a.js, tests pass.');
  assert.equal(d.replyWords, 5);
  assert.deepEqual(r.events.map((e) => [e.kind, e.data.subcommands]), [['blocked', ['add', 'commit']]]);
  const service = JSON.parse((await get('/api/runs/2')).body);
  assert.equal(service.transcript, 'unavailable');
  assert.equal((await get('/api/runs/99')).status, 200);
});

test('the page builds every text with textContent, so transcript contents are never read as HTML', () => {
  const page = readFileSync(new URL('../viewer/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(page, /prefers-color-scheme: dark/);
});

test('jerome state --json carries the team too', () => {
  const s = readState(dir, { readOnly: true });
  assert.ok(s.team.subagents.length >= 1);
  assert.equal(statSync(join(dir, '.jerome.db')).isFile(), true);
});
