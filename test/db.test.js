// Tests of the project database (phase 5): migrations, retention, reading transcripts, account.json and
// `jerome state`, with a fake `claude` on the PATH where the CLI is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandbox } from './sandbox.js';
import { openDb, applyMigrations, schemaVersion, prune, migrations, LATEST } from '../src/db.js';
import { ingestTranscript, parseCall } from '../src/usage.js';
import { recordWindows, readAccount } from '../src/account.js';
import { readState, formatState, dollars } from '../src/state.js';
import { callPrice } from '../src/models.js';
import { projectStatus } from '../src/budget.js';

const NOW = new Date('2026-10-15T12:00:00Z');
const temp = () => mkdtempSync(join(tmpdir(), 'jerome-db-'));

// One assistant line as Claude Code writes it, with only the fields Jérôme reads plus some it must ignore.
function line({ id, model = 'claude-sonnet-5-5', at = '2026-10-15T10:00:00Z', input = 10, output = 100, read = 1000, w1h = 500, w5m = 0 }) {
  return `${JSON.stringify({
    type: 'assistant', requestId: id, timestamp: at, serverClassifierRequest: 'x',
    message: { model, content: [{ type: 'text', text: 'never read' }], usage: {
      input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: w1h + w5m,
      cache_creation: { ephemeral_1h_input_tokens: w1h, ephemeral_5m_input_tokens: w5m } } },
  })}\n`;
}

test('a new project gets the database from doctor, kept out of git; doctor --check writes nothing', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const dir = join(root, 'demo');
  assert.ok(existsSync(join(dir, '.jerome.db')));
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.jerome\.db\*$/m);
  const ignored = spawnSync('git', ['check-ignore', '.jerome.db', '.jerome.db-wal'], { cwd: dir });
  assert.equal(ignored.status, 0);
  const r = run('doctor', 'demo', '--check', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).checks.find((c) => c.id === 'db').detail, `schema ${LATEST}`);
  assert.ok(!existsSync(join(dir, '.jerome.db-shm')), '--check must not open the database');
  // The SQLite experimental warning never reaches the output.
  assert.doesNotMatch(r.stderr, /ExperimentalWarning/);
});

test('doctor --check fails without the database, and doctor creates it', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const dir = join(root, 'demo');
  for (const f of ['.jerome.db', '.jerome.db-wal', '.jerome.db-shm']) if (existsSync(join(dir, f))) spawnSync('rm', [join(dir, f)]);
  const check = run('doctor', 'demo', '--check');
  assert.equal(check.status, 1);
  assert.match(check.stdout, /✗ Project database — \.jerome\.db is missing/);
  assert.match(run('doctor', 'demo').stdout, /✓ Project database — \.jerome\.db created \(schema 1\)/);
});

test('a new migration keeps the existing data, and a newer database is refused', () => {
  const dir = temp();
  const db = openDb(dir, { create: true });
  db.prepare("INSERT INTO runs (session_id, kind, started_at) VALUES ('s1', 'interactive', ?)").run(NOW.toISOString());
  const folder = join(dir, 'migrations');
  mkdirSync(folder);
  writeFileSync(join(folder, '001-init.sql'), readFileSync(new URL('../migrations/001-init.sql', import.meta.url), 'utf8'));
  writeFileSync(join(folder, '002-note.sql'), 'ALTER TABLE runs ADD COLUMN note TEXT;');
  assert.deepEqual(applyMigrations(db, migrations(folder)), ['002-note.sql']);
  assert.equal(schemaVersion(db), 2);
  assert.equal(db.prepare('SELECT count(*) n FROM runs').get().n, 1);
  db.close();
  assert.throws(() => openDb(dir), /schema version 2, this Jérôme knows up to 1/);
});

test('transcripts are read from the saved offset, deduplicated, and from the start when they get shorter', () => {
  const dir = temp();
  const db = openDb(dir, { create: true });
  const path = join(dir, 'session.jsonl');
  // The same requestId twice (one response, several content blocks), and a line still being written.
  writeFileSync(path, line({ id: 'r1' }) + line({ id: 'r1' }) + '{"type":"user"}\n' + line({ id: 'r2', model: 'claude-opus-5-5' }).trimEnd());
  assert.deepEqual(ingestTranscript(db, { path, agent: 'main', now: NOW }).calls, 1);
  appendFileSync(path, '\n' + line({ id: 'r3' }));
  assert.equal(ingestTranscript(db, { path, agent: 'main', now: NOW }).calls, 2);
  assert.equal(ingestTranscript(db, { path, agent: 'main', now: NOW }).calls, 0);
  // A rewritten, shorter transcript is read again from the start: r1 is already counted, r9 is new.
  writeFileSync(path, line({ id: 'r1' }) + line({ id: 'r9' }));
  assert.equal(ingestTranscript(db, { path, agent: 'main', now: NOW }).calls, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM usage').get().n, 4);
  // A response written as several lines: output_tokens grows until the last one, which is the true value.
  writeFileSync(path, line({ id: 'r5', output: 8 }) + line({ id: 'r5', output: 458 }));
  ingestTranscript(db, { path, agent: 'main', now: NOW });
  writeFileSync(path, line({ id: 'r5', output: 8 }));
  ingestTranscript(db, { path, agent: 'main', now: NOW });
  assert.equal(db.prepare("SELECT output FROM usage WHERE request_id = 'r5'").get().output, 458);
  // Lines older than the retention period are not read again, or usage_daily would count them twice.
  writeFileSync(path, line({ id: 'old', at: '2026-01-01T00:00:00Z' }));
  assert.equal(ingestTranscript(db, { path, agent: 'main', now: NOW }).calls, 0);
  db.close();
});

test('parseCall reads usage and never the message contents', () => {
  const call = parseCall(line({ id: 'r1', w5m: 7 }).trim());
  assert.deepEqual(call, { requestId: 'r1', model: 'claude-sonnet-5-5', input: 10, output: 100, cache_read: 1000,
    cache_write_5m: 7, cache_write_1h: 500, at: '2026-10-15T10:00:00.000Z' });
  assert.equal(parseCall('{"type":"user","requestId":"x"}'), null);
  assert.equal(parseCall('not json "requestId"'), null);
});

test('retention sums old usage into usage_daily and deletes old events, keeping the totals', () => {
  const dir = temp();
  const db = openDb(dir, { create: true });
  const add = db.prepare(`INSERT INTO usage (request_id, agent, model, input, output, cache_read, at) VALUES (?, 'main', 'claude-opus-5-5', 1, 2, 3, ?)`);
  add.run('a', '2026-06-01T10:00:00Z');
  add.run('b', '2026-06-01T11:00:00Z');
  add.run('c', '2026-10-14T10:00:00Z');
  db.prepare("INSERT INTO events (at, kind) VALUES ('2026-09-01T00:00:00Z', 'stop'), ('2026-10-14T00:00:00Z', 'stop')").run();
  assert.deepEqual(prune(db, NOW), { usage: 2, events: 1, reads: 0 });
  assert.deepEqual({ ...db.prepare('SELECT day, requests, input, output, cache_read FROM usage_daily').get() },
    { day: '2026-06-01', requests: 2, input: 2, output: 4, cache_read: 6 });
  assert.equal(db.prepare('SELECT count(*) n FROM usage').get().n, 1);
  db.close();
});

test('account.json records a window only when it changes', () => {
  const path = join(temp(), 'account.json');
  assert.equal(recordWindows({ five_hour: { used: 43, resetsAt: 1 } }, { source: 'statusline', path, now: NOW }), true);
  assert.equal(recordWindows({ five_hour: { used: 43, resetsAt: 1 } }, { source: 'heartbeat', path, now: NOW }), false);
  assert.equal(recordWindows({ seven_day: { used: 10, resetsAt: 2 } }, { source: 'heartbeat', path, now: NOW }), true);
  const account = readAccount(path);
  assert.equal(account.schema, 'jerome.account/v1');
  assert.deepEqual(Object.keys(account.windows), ['five_hour', 'seven_day']);
  assert.equal(account.windows.five_hour.source, 'statusline');
});

test('prices match the API list prices, and an unknown model has none', () => {
  // A real Opus 5.5 call: Claude Code reported $0.1139 for it.
  const price = callPrice('claude-opus-5-5', { input: 8, output: 1384, cache_read: 54164, cache_write_5m: 0, cache_write_1h: 9422 });
  assert.equal(Math.round(price * 10000) / 10000, 0.1139);
  assert.equal(callPrice('claude-unknown-1', { input: 1, output: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }), null);
});

test('state is compact, labels dollars as API equivalents, and lists runs and open requests', () => {
  const dir = temp();
  const db = openDb(dir, { create: true });
  const run = db.prepare("INSERT INTO runs (session_id, kind, started_at, status) VALUES ('s1', 'heartbeat', '2026-10-15T09:00:00Z', 'done')").run().lastInsertRowid;
  const path = join(dir, 's1.jsonl');
  writeFileSync(path, line({ id: 'r1', model: 'claude-opus-5-5' }) + line({ id: 'r2', at: '2026-10-12T10:00:00Z' }) + line({ id: 'r3', model: 'claude-unknown-1' }));
  ingestTranscript(db, { path, agent: 'main', runId: run, now: NOW });
  db.prepare("INSERT INTO requests (run_id, opened_at, question) VALUES (?, '2026-10-15T09:30:00Z', 'merge task/x: tests fail')").run(run);
  db.close();

  const account = { windows: { five_hour: { used: 43, resetsAt: 1, readAt: '2026-10-15T11:00:00Z', source: 'statusline' } }, limits: { five_hour: 80 } };
  const s = readState(dir, { now: NOW, account });
  assert.equal(s.schema, 'jerome.state/v1');
  assert.equal(s.usage.week.calls, 3);
  assert.equal(s.usage.week.unpriced, true);
  assert.deepEqual(s.requests.map((r) => r.id), [1]);
  const text = formatState(s);
  assert.match(text, /≈\$\d+\.\d{2}\+\? API/);
  assert.doesNotMatch(text.split('\n').filter((l) => !l.startsWith('limits')).join('\n').replace(/≈\$[\d.]+(\+\?)? API/g, ''), /\$/);
  assert.match(text, /^window  5h 43% \(statusline, /m);
  assert.match(text, /global limits 80%/);
  assert.match(text, /heartbeat done 5k/);
  assert.match(text, /^open    R1 merge task\/x: tests fail/m);
  assert.match(text, /record each answer with `jerome request answer <id>/);
  assert.match(text, /^limits  today ≈\$\d+\.\d{2}\/\$5 · this week ≈\$\d+\.\d{2}\/\$20 API$/m);
  assert.ok(text.split('\n').length <= 8);
});

test('jerome state on a project without the database says how to create it', () => {
  const { root, run } = sandbox();
  mkdirSync(join(root, 'p'));
  writeFileSync(join(root, 'p', '.jerome'), '');
  const r = run('state', 'p');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\.jerome\.db is missing: run `jerome doctor`/);
  assert.equal(run('state', 'p', '--runs', 'x').status, 2);
});

test('amounts below a cent show as <$0.01, and cache reads and writes are kept apart', () => {
  assert.equal(dollars(0), '$0.00');
  assert.equal(dollars(0.0012), '<$0.01');
  assert.equal(dollars(0.005), '≈$0.01');
  assert.equal(dollars(3.4), '≈$3.40');
  const dir = temp();
  const db = openDb(dir, { create: true });
  const path = join(dir, 's.jsonl');
  writeFileSync(path, line({ id: 'r1', read: 1000, w1h: 500, w5m: 20 }));
  ingestTranscript(db, { path, agent: 'main', now: NOW });
  db.close();
  const s = readState(dir, { now: NOW, account: { windows: {}, limits: {} } });
  assert.deepEqual([s.usage.week.cacheRead, s.usage.week.cacheWrite, s.usage.week.cache], [1000, 520, 1520]);
  assert.deepEqual([s.byModel.week[0].cacheRead, s.byModel.week[0].cacheWrite], [1000, 520]);
  assert.match(formatState(s), /cache read 1k · write 520\)/);
});

test('the progress line is drawn only on a terminal, and says what the stream is doing', async () => {
  const { startProgress, actionOf, describeTool } = await import('../src/progress.js');
  const written = [];
  const tty = { isTTY: true, columns: 80, write: (s) => written.push(s) };
  const p = startProgress('starting', { stream: tty, env: {} });
  p.update(actionOf({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/docs/_pending.md' } }] } }));
  await new Promise((r) => setTimeout(r, 150));
  p.stop();
  assert.ok(written.some((s) => /^\r. \ds · reading docs\/_pending\.md/.test(s)), written.join('|'));
  assert.equal(written.at(-1), '\r\x1b[K');
  const silent = [];
  const pipe = { isTTY: false, write: (s) => silent.push(s) };
  const q = startProgress('starting', { stream: pipe, env: {} });
  q.stop();
  assert.deepEqual(silent, []);
  assert.equal(startProgress('x', { stream: tty, env: { CI: '1' } }).live, false);
  assert.equal(describeTool('Bash', { description: 'Run the tests' }), 'running Run the tests');
  assert.equal(describeTool('Agent', { subagent_type: 'analyst' }), 'delegating to analyst');
  assert.equal(actionOf({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }), 'writing the reply');
});

test('Haiku 5.5 is priced by the prompt of each call, also when calls are summed', () => {
  const dir = temp();
  const db = openDb(dir, { create: true });
  const add = db.prepare("INSERT INTO usage (request_id, agent, model, input, output, cache_read, at) VALUES (?, ?, 'claude-haiku-5-5', 60000, 0, 0, ?)");
  add.run('a', 'triage', NOW.toISOString());
  add.run('b', 'documentarist', NOW.toISOString());
  db.close();
  // Two 60k prompts: each in the short tier ($0.10 per MTok), $0.012 in all, whatever the grouping.
  const s = readState(dir, { now: NOW, account: { windows: {}, limits: {} } });
  assert.equal(s.usage.week.apiUsd, 0.012);
  const d2 = openDb(dir);
  const p = projectStatus(dir, d2, NOW);
  d2.close();
  assert.equal(p.daily.usd, 0.012);
});
