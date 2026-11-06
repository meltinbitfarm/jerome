// Jérôme Director, step 1 (D145-D154): a real Director process on loopback, Macs as throwaway sandboxes, and the
// requests a forger, a replayer or a revoked Mac would send.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { privateAddress, parseListen, checkListen, checkShape } from '../src/director.js';
import { newKeys, signRequest, verifyResponse } from '../src/sign.js';
import { scrub } from '../src/scrub.js';
import { atLeast } from '../src/directorlink.js';
import { readyProject, sandboxDb } from './sandbox.js';

const BIN = new URL('../bin/jerome.js', import.meta.url).pathname;
const H = 3_600_000;

test('the Director listens only on a VPN or private address, and in a container only when published on one', () => {
  for (const a of ['127.0.0.1', '10.0.0.1', '172.20.1.1', '192.168.1.10', '100.101.102.103', 'fd7a:115c:a1e0::1', '::1']) assert.ok(privateAddress(a), a);
  for (const a of ['8.8.8.8', '100.128.0.1', '172.32.0.1', '2001:db8::1', '0.0.0.0', 'localhost']) assert.ok(!privateAddress(a), a);
  assert.deepEqual(parseListen('100.101.102.103'), { host: '100.101.102.103', port: 7788 });
  assert.deepEqual(parseListen('[fd7a::1]:9000'), { host: 'fd7a::1', port: 9000 });
  assert.match(checkListen({ host: '51.15.1.2' }, {}), /public address/);
  assert.match(checkListen({ host: '0.0.0.0' }, {}), /never listens on every interface/);
  assert.match(checkListen({ host: '0.0.0.0' }, { DIRECTOR_ADDRESS: '51.15.1.2' }), /public address/);
  assert.equal(checkListen({ host: '0.0.0.0' }, { DIRECTOR_ADDRESS: '100.101.102.103' }), null);
});

test('a beat with a field the Director does not know, or a text too long, is refused', () => {
  const shape = { name: 'string:5', 'n?': 'number', list: [{ id: 'number' }, 2] };
  assert.equal(checkShape({ name: 'mini', list: [{ id: 1 }] }, shape), null);
  assert.match(checkShape({ name: 'mini', list: [], cmd: 'rm -rf' }, shape), /body\.cmd is not a field the Director knows/);
  assert.match(checkShape({ name: 'toolong', list: [] }, shape), /at most 5 characters/);
  assert.match(checkShape({ name: 'mini', list: [{ id: 1 }, { id: 2 }, { id: 3 }] }, shape), /list of at most 2/);
  assert.match(checkShape({ name: 'mini', list: [{ id: '1' }] }, shape), /body\.list\[0\]\.id must be a number/);
});

test('a text leaves the Mac with no path and no line break', () => {
  assert.equal(scrub('permission denied for Bash(cd /Users/odinai/Projects/climbdaily/data && python3 -c "\nimport json")'),
    'permission denied for Bash(cd …/data && python3 -c " import json")');
  assert.equal(scrub('Run `jerome doctor` in /Users/odinai/Projects/meltinbit-radar and fix it'), 'Run `jerome doctor` in …/meltinbit-radar and fix it');
  assert.equal(scrub("tail /tmp/check-fame.log, /private/var/folders/x/T/a.json; /home/me/"), 'tail …/check-fame.log, …/a.json; …/me');
  assert.equal(scrub('uncommitted changes (.claude/settings.json) on main'), 'uncommitted changes (.claude/settings.json) on main');
});

// A free port on loopback for the Director.
async function freePort() {
  const s = createServer();
  await new Promise((done) => s.listen(0, '127.0.0.1', done));
  const { port } = s.address();
  await new Promise((done) => s.close(done));
  return port;
}

const servers = [];
after(() => { for (const s of servers) s.kill('SIGTERM'); });

// `extra` adds to the Director's environment; `before(home)` runs once it is set up, before it serves.
async function startDirector({ extra = {}, before = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jerome-director-'));
  const port = await freePort();
  const env = { PATH: process.env.PATH, HOME: home, ...extra };
  const cli = (...args) => spawnSync(process.execPath, [BIN, 'director', ...args], { env, encoding: 'utf8' });
  const init = cli('init', '--listen', `127.0.0.1:${port}`);
  assert.equal(init.status, 0, init.stderr);
  before?.(home);
  const child = spawn(process.execPath, [BIN, 'director', 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  for (let i = 0; i < 100 && !/listening on/.test(out); i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.match(out, /listening on 127\.0\.0\.1:/);
  const db = () => new DatabaseSync(join(home, '.local', 'share', 'jerome-director', 'director.db'), { readOnly: true });
  const fp = init.stdout.match(/fingerprint {2}([0-9A-F-]{19})/)[1];
  return { home, url: `http://127.0.0.1:${port}`, cli, db, log: () => out, fingerprint: fp };
}

function mac(name, extra = {}) {
  const p = readyProject({ JEROME_NOTIFY: 'off', JEROME_PLAIN_SYNC: '1', ...extra });
  const endpoint = join(p.root, 'usage.json');
  writeFileSync(endpoint, JSON.stringify({
    five_hour: { utilization: 14, resets_at: new Date(Date.now() + 2 * H).toISOString() },
    seven_day: { utilization: 6, resets_at: new Date(Date.now() + 6.5 * 24 * H).toISOString() },
    limits: [], seven_day_breakdown: { rows: [] },
  }));
  const env = { JEROME_QUOTA_FAKE: endpoint };
  return {
    ...p,
    name,
    connect: (url, answer = 'y') => p.runWithInput(env, `${answer}\n`, 'connect', url, '--name', name),
    beat: () => p.runWith(env, 'watchdog', 'run'),
    jerome: (...args) => p.runWith(env, ...args),
    link: () => JSON.parse(readFileSync(join(p.root, '.config', 'jerome', 'director.json'), 'utf8')),
    watchdogLog: () => readFileSync(join(p.root, '.cache', 'jerome', 'logs', 'watchdog.log'), 'utf8'),
  };
}

test('a Mac connects after Fabio compares the fingerprint, waits for approval, then its beats carry the quota and its projects, never a path', async () => {
  const d = await startDirector();
  const m = mac('mini');
  // A fingerprint Fabio does not recognise: nothing is kept.
  const no = m.connect(d.url, 'n');
  assert.equal(no.status, 1);
  assert.ok(!existsSync(join(m.root, '.config', 'jerome', 'director.json')));

  const r = m.connect(d.url);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`The Director's fingerprint is ${d.fingerprint}.`));
  const code = m.link().machine;
  assert.match(r.stdout, new RegExp(`mini is waiting for approval\\. Its code: ${code}`));
  assert.equal(statSync(join(m.root, '.config', 'jerome', 'director.json')).mode & 0o777, 0o600);

  // Not approved yet: the beat is refused, and the Mac says so.
  m.beat();
  assert.match(m.jerome('connect', 'status').stdout, /waiting for approval: on the server, jerome director approve/);
  assert.equal(d.cli('approve', code.toLowerCase().replace(/-/g, '')).status, 0);
  m.beat();
  assert.match(m.jerome('connect', 'status').stdout, /code [0-9A-F-]+ · approved\nbeat {5}last answered 0 min ago/);
  assert.match(m.watchdogLog(), /director: waiting for approval[\s\S]*director: beat answered/);

  const db = d.db();
  const machine = db.prepare('SELECT * FROM machines').get();
  const project = db.prepare('SELECT * FROM projects').get();
  const reading = db.prepare('SELECT * FROM readings').get();
  db.close();
  assert.equal(machine.name, 'mini');
  assert.ok(machine.last_beat);
  assert.equal(project.name, 'demo');
  const data = JSON.parse(project.data);
  assert.deepEqual(Object.keys(data).sort(), ['alerts', 'fill', 'key', 'lastHeartbeat', 'name', 'overLimit', 'requests', 'running', 'slots', 'usage']);
  assert.ok(!project.data.includes(m.root), 'no path leaves the Mac');
  assert.equal(JSON.parse(reading.data).windows.seven_day.used, 6);
  assert.ok(!/token|Bearer/i.test(reading.data));
  assert.match(d.cli('machines').stdout, /^mini +[0-9A-F-]{19} +approved +\d{4}-\d\d-\d\d \d\d:\d\d +1$/m);
  assert.match(d.cli('status').stdout, /macs {5}1 approved, 0 waiting for approval\nquota {4}5h 14% · 7d 6%/);

  // A finished heartbeat goes in the next beat, once.
  m.run('heartbeat', 'demo');
  m.beat();
  m.beat();
  const db2 = d.db();
  const runs = db2.prepare('SELECT data FROM runs').all();
  db2.close();
  assert.equal(runs.length, 1);
  assert.equal(JSON.parse(runs[0].data).project, data.key);

  // The project's board (D177) goes with the beat when it changes, its texts in plain words once rewritten.
  writeFileSync(join(m.dir, '.jerome', 'open.md'), '# Open\n\n## To do\nO3: add the archive page (developer)\n');
  m.beat();
  m.beat();
  const db3 = d.db();
  const boards = db3.prepare('SELECT key, data FROM boards').all();
  db3.close();
  assert.equal(boards.length, 1);
  assert.equal(boards[0].key, data.key);
  const board = JSON.parse(boards[0].data);
  assert.deepEqual(board.todo, [{ id: 'O3', text: 'plain: add the archive page (developer)', kind: 'todo' }]);
  assert.ok(!boards[0].data.includes(m.root), 'no path leaves the Mac');
  const state = JSON.parse(readFileSync(join(m.root, '.cache', 'jerome', 'director', 'state.json'), 'utf8'));
  assert.ok(state.boards[data.key].hash);

  // Revoked: refused from then on, and the Mac knows it.
  assert.equal(d.cli('revoke', 'mini').status, 0);
  m.beat();
  assert.match(m.jerome('connect', 'status').stdout, /revoked on the Director/);
  assert.match(m.jerome('disconnect').stdout, /Disconnected from/);
  assert.ok(!existsSync(join(m.root, '.config', 'jerome', 'director.json')));
});

test('forged, replayed, late or unsigned requests are refused, and a Mac trusts only answers signed with the key it pinned', async () => {
  const d = await startDirector();
  const m = mac('m4');
  m.connect(d.url);
  d.cli('approve', m.link().machine);
  const link = m.link();
  const body = JSON.stringify({ version: '0', at: new Date().toISOString(), quota: null, projects: [], runs: [] });
  const post = (headers, text = body) => fetch(`${d.url}/v1/beat`, { method: 'POST', body: text, headers: { ...headers, 'content-type': 'application/json' } });
  const signed = (opts = {}) => signRequest({ method: 'POST', path: '/v1/beat', body: opts.body ?? body, machine: link.machine, privatePem: opts.key ?? link.key.private, now: opts.now });

  const good = signed();
  const ok = await post(good);
  const okText = await ok.text();
  assert.equal(ok.status, 200);
  assert.ok(verifyResponse({ status: 200, body: okText, nonce: good['x-jerome-nonce'], headers: ok.headers, publicPem: link.director.publicKey }));
  // The same answer is not valid for another request, nor under another key.
  assert.ok(!verifyResponse({ status: 200, body: okText, nonce: 'another', headers: ok.headers, publicPem: link.director.publicKey }));
  assert.ok(!verifyResponse({ status: 200, body: okText, nonce: good['x-jerome-nonce'], headers: ok.headers, publicPem: newKeys().public }));

  const refusal = async (res) => [res.status, (await res.json()).error];
  assert.deepEqual(await refusal(await post(good)), [401, 'request replayed']);
  assert.deepEqual(await refusal(await post({})), [401, 'unknown Mac: run `jerome connect` again']);
  assert.deepEqual(await refusal(await post(signed({ key: newKeys().private }))), [401, 'bad signature']);
  assert.deepEqual(await refusal(await post(signed({ now: Date.now() - 10 * 60_000 }))), [401, 'time too far from the Director\'s clock']);
  const tampered = signed();
  assert.deepEqual(await refusal(await post(tampered, body.replace('"0"', '"1"'))), [401, 'bad signature']);
  const extra = JSON.stringify({ ...JSON.parse(body), command: 'rm -rf ~' });
  assert.deepEqual(await refusal(await post(signed({ body: extra }), extra)), [400, 'body.command is not a field the Director knows']);
  const big = 'x'.repeat(260 * 1024);
  assert.equal((await post(signed({ body: big }), big)).status, 413);
  assert.equal((await fetch(`${d.url}/v1/anything`)).status, 404);
  assert.match(d.log(), /refused \/v1\/beat from [0-9A-F-]+: request replayed/);
});

test('the dashboard is a page under a strict policy, its data only with the token, and its only write is an order', async () => {
  const d = await startDirector();
  const m = mac('mini');
  assert.equal(m.connect(d.url).status, 0);
  assert.equal(d.cli('approve', m.link().machine).status, 0);
  m.beat();

  const shown = d.cli('dashboard').stdout;
  const token = shown.match(/#([A-Za-z0-9_-]+)/)[1];
  assert.ok(shown.startsWith(`${d.url}/#${token}`));

  const page = await fetch(`${d.url}/`);
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy');
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)[1];
  assert.match(csp, /default-src 'none'.*connect-src 'self'.*frame-ancestors 'none'/);
  const html = await page.text();
  assert.ok(html.includes(`<script nonce="${nonce}">`) && html.includes(`<style nonce="${nonce}">`));
  assert.ok(!html.includes(token), 'the page holds no secret');
  assert.ok(!/innerHTML/.test(html), 'every text is set with textContent');
  // The boards' script (D177) is inline under the same nonce: the policy loads nothing else.
  assert.ok(html.includes('function boardView') && !html.includes('<script src='));
  assert.equal(html.match(/<script nonce=/g).length, 2);

  const icon = await fetch(`${d.url}/apple-touch-icon.png`);
  assert.equal(icon.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await icon.arrayBuffer()).slice(1, 4)], [0x50, 0x4e, 0x47]);

  for (const auth of [undefined, 'Bearer wrong', `Bearer ${token}x`]) {
    const r = await fetch(`${d.url}/api/overview`, { headers: auth ? { authorization: auth } : {} });
    assert.equal(r.status, 403, String(auth));
  }
  const r = await fetch(`${d.url}/api/overview`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const o = await r.json();
  assert.equal(o.schema, 'jerome.director.overview/v1');
  assert.equal(o.quota.windows.seven_day.used, 6);
  assert.equal(o.quota.series.length, 1);
  assert.equal(o.quota.pace.verdict, 'go');
  assert.deepEqual(o.machines.map((x) => [x.name, x.status, x.reachable, x.projects]), [['mini', 'approved', true, 1]]);
  assert.equal(o.projects[0].name, 'demo');
  // In the language of the Mac that beat last (D163), with each project's state and what waits for the user.
  assert.equal(o.language, 'en');
  assert.equal(o.projects[0].state, 'idle');
  // The last work is the last run done, never a stop's reason.
  assert.equal(o.projects[0].lastDone?.at ?? null, o.runs.find((x) => x.status === 'done')?.endedAt ?? null);
  assert.deepEqual(o.attention, []);
  assert.ok(!JSON.stringify(o).includes(m.root), 'no path reaches the dashboard');

  // Only GET is the dashboard's: anything else is the Macs' signed API, and refused unsigned.
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const w = await fetch(`${d.url}/api/overview`, { method, headers: { authorization: `Bearer ${token}` } });
    assert.notEqual(w.status, 200, method);
  }

  // A new token: the old one no longer opens it.
  assert.equal(d.cli('dashboard', '--new-token').status, 0);
  assert.equal((await fetch(`${d.url}/api/overview`, { headers: { authorization: `Bearer ${token}` } })).status, 403);
});

test('an order from the dashboard reaches the Mac in its beat, is checked and run there, told on Telegram, and its outcome shown (D191)', async () => {
  const d = await startDirector();
  const fake = mkdtempSync(join(tmpdir(), 'jerome-tg-'));
  const m = mac('mini', { JEROME_TELEGRAM_FAKE: fake });
  mkdirSync(join(m.root, '.config', 'jerome'), { recursive: true });
  writeFileSync(join(m.root, '.config', 'jerome', 'telegram.json'), JSON.stringify({ token: '1:x', chatId: 7, chat: 'Fabio', bot: 'jerome_test_bot' }));
  assert.equal(m.connect(d.url).status, 0);
  assert.equal(d.cli('approve', m.link().machine).status, 0);
  assert.equal(m.runIn(m.dir, 'request', 'open', '--question', 'Which host?', '--options', 'A) Fly.io / B) Render', '--recommendation', 'A').status, 0);
  m.beat();
  const token = d.cli('dashboard').stdout.match(/#([A-Za-z0-9_-]+)/)[1];
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const overview = async () => (await fetch(`${d.url}/api/overview`, { headers: auth })).json();
  const send = (body, headers = auth) => fetch(`${d.url}/api/order`, { method: 'POST', headers, body: JSON.stringify(body) });

  const o = await overview();
  const ask = o.attention.find((a) => a.kind === 'request');
  assert.deepEqual(ask.choices, ['A) Fly.io', 'B) Render']);
  const where = { machine: ask.machineCode, project: ask.key };

  // Refused: no token, a project or question that is not there, an option it does not have, an action no block offers.
  assert.equal((await send({ ...where, kind: 'note', text: 'x' }, { 'content-type': 'application/json' })).status, 403);
  assert.equal((await send({ ...where, project: 'nope', kind: 'note', text: 'x' })).status, 400);
  assert.equal((await send({ ...where, kind: 'answer', ref: 99, choice: 0 })).status, 400);
  assert.equal((await send({ ...where, kind: 'answer', ref: ask.id, choice: 5 })).status, 400);
  assert.equal((await send({ ...where, kind: 'action', ref: 1, action: 'commit' })).status, 400);
  assert.equal((await send({ ...where, kind: 'shell', text: 'rm -rf /' })).status, 400);
  assert.equal((await send({ ...where, kind: 'note', text: 'x'.repeat(2001) })).status, 400);

  // A tap on an option, the same tap again, and a note.
  assert.equal((await send({ ...where, kind: 'answer', ref: ask.id, choice: 1 })).status, 201);
  assert.equal((await send({ ...where, kind: 'answer', ref: ask.id, choice: 0 })).status, 409);
  assert.equal((await send({ ...where, kind: 'note', text: 'The pricing page should mention the free plan.' })).status, 201);
  const waiting = await overview();
  assert.deepEqual(waiting.orders.map((x) => [x.kind, x.status]), [['note', 'pending'], ['answer', 'pending']]);
  // Answered from here, the question leaves the page at once, before the Mac's next beat says it is closed.
  assert.deepEqual(waiting.attention, []);
  assert.equal(waiting.projects[0].state, 'idle');

  // The next beat carries them; the Mac runs them under its own checks and reports at once.
  m.beat();
  const project = m.db();
  const request = project.prepare('SELECT status, answer FROM requests WHERE id = ?').get(ask.id);
  const notes = project.prepare('SELECT text, source FROM notes').all().map((n) => ({ ...n }));
  project.close();
  assert.deepEqual({ ...request }, { status: 'answered', answer: 'B) Render' });
  assert.deepEqual(notes, [{ text: 'The pricing page should mention the free plan.', source: 'director' }]);
  const after = await overview();
  assert.deepEqual(after.orders.map((x) => [x.kind, x.status]), [['note', 'done'], ['answer', 'done']]);
  assert.match(after.orders[1].result, /R\d+ answered: B\) Render/);
  assert.match(m.watchdogLog(), /director: order \d+ done/);

  // The user hears of each one on Telegram, so an order they did not send is seen at once.
  m.beat();
  const told = readFileSync(join(fake, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => c.method === 'sendMessage').map((c) => c.params?.text ?? c.text ?? '');
  assert.ok(told.some((x) => /From the Director's dashboard: R\d+ answered: B\) Render/.test(x) && /--new-token/.test(x)), told.join('\n---\n'));
  assert.ok(told.some((x) => /From the Director's dashboard: note N\d+/.test(x)));

  // Given again (its result lost), an order is reported, not run twice; one older than 10 minutes lapses unrun.
  const w = new DatabaseSync(join(d.home, '.local', 'share', 'jerome-director', 'director.db'));
  w.prepare("UPDATE orders SET status = 'pending' WHERE kind = 'note'").run();
  w.prepare("INSERT INTO orders (machine, project, kind, text, created_at) VALUES (?, ?, 'note', 'stale', ?)").run(where.machine, where.project, new Date(Date.now() - 11 * 60_000).toISOString());
  w.close();
  m.beat();
  const again = m.db();
  assert.deepEqual(again.prepare('SELECT text FROM notes').all().map((n) => n.text), ['The pricing page should mention the free plan.']);
  again.close();
  const last = await overview();
  assert.deepEqual(last.orders.map((x) => [x.kind, x.text, x.status]), [['note', 'stale', 'lapsed'], ['note', 'The pricing page should mention the free plan.', 'done'], ['answer', 'B) Render', 'done']]);

  // A block's button: the action it offers, run on the Mac by the same code as on Telegram (D167).
  writeFileSync(join(m.dir, 'draft.md'), 'mine\n');
  m.git('add', 'draft.md');
  m.git('commit', '-q', '-m', 'draft');
  writeFileSync(join(m.dir, 'draft.md'), 'mine, changed\n');
  const pw = m.writableDb();
  pw.prepare("INSERT INTO alerts (key, reason, opened_at, last_at) VALUES ('k', 'uncommitted changes (draft.md) on main, not left by a heartbeat: commit or discard them', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
  pw.close();
  m.beat();
  const block = (await overview()).attention.find((a) => a.kind === 'block');
  assert.deepEqual(block.actions.map((x) => x.name), ['commit', 'stash']);
  assert.equal(block.actions[1].label, 'Set them aside');
  assert.equal((await send({ ...where, kind: 'action', ref: block.id, action: 'budget' })).status, 400);
  assert.equal((await send({ ...where, kind: 'action', ref: block.id, action: 'stash' })).status, 201);
  assert.deepEqual((await overview()).attention, []);
  m.beat();
  assert.match(execFileSync('git', ['stash', 'list'], { cwd: m.dir, encoding: 'utf8' }), /set aside from afar/);
  const closed = m.db();
  assert.equal(closed.prepare('SELECT status FROM alerts WHERE id = ?').get(block.id).status, 'resolved');
  closed.close();
  assert.equal((await overview()).orders[0].status, 'done');
});

test('a question answered on Telegram leaves the dashboard in the same pass, by a beat sent at once (D193)', async () => {
  const d = await startDirector();
  const fake = mkdtempSync(join(tmpdir(), 'jerome-tg-'));
  const m = mac('mini', { JEROME_TELEGRAM_FAKE: fake });
  mkdirSync(join(m.root, '.config', 'jerome'), { recursive: true });
  writeFileSync(join(m.root, '.config', 'jerome', 'telegram.json'), JSON.stringify({ token: '1:x', chatId: 7, chat: 'Fabio', bot: 'jerome_test_bot' }));
  assert.equal(m.connect(d.url).status, 0);
  assert.equal(d.cli('approve', m.link().machine).status, 0);
  assert.equal(m.runIn(m.dir, 'request', 'open', '--question', 'Which host?', '--options', 'A) Fly.io / B) Render', '--recommendation', 'A').status, 0);
  // The watchdog's pass: the beat, then the bridge sends the question.
  m.beat();
  const token = d.cli('dashboard').stdout.match(/#([A-Za-z0-9_-]+)/)[1];
  const overview = async () => (await fetch(`${d.url}/api/overview`, { headers: { authorization: `Bearer ${token}` } })).json();
  const ask = (await overview()).attention.find((a) => a.kind === 'request');
  assert.ok(ask);
  const calls = () => readFileSync(join(fake, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const at = calls().findIndex((c) => c.method === 'sendMessage' && /Which host/.test(c.params.text));
  assert.ok(at >= 0);
  // A tap on B. The pass beats first, while the question is still open; the bridge then answers it and beats again.
  writeFileSync(join(fake, 'updates.json'), JSON.stringify([{ update_id: 1, callback_query: { id: 'q1', data: `a:${ask.id}:1`, message: { message_id: 1000 + at + 1, chat: { id: 7, type: 'private' } } } }]));
  m.beat();
  const project = m.db();
  assert.equal(project.prepare('SELECT status FROM requests WHERE id = ?').get(ask.id).status, 'answered');
  project.close();
  const after = await overview();
  assert.deepEqual(after.attention, []);
  assert.deepEqual(after.orders, []);
  assert.ok(!existsSync(join(m.root, '.cache', 'jerome', 'director', 'beat.lock')), 'the lock goes with its beat');
});

test('the dashboard shows what is unlocked and the push asked: a tap pushes main on the Mac, another locks again; unlocking stays at the Mac (D196)', async () => {
  const d = await startDirector();
  const fake = mkdtempSync(join(tmpdir(), 'jerome-tg-'));
  const m = mac('mini', { JEROME_TELEGRAM_FAKE: fake });
  mkdirSync(join(m.root, '.config', 'jerome'), { recursive: true });
  writeFileSync(join(m.root, '.config', 'jerome', 'telegram.json'), JSON.stringify({ token: '1:x', chatId: 7, chat: 'Fabio', bot: 'jerome_test_bot' }));
  const remote = join(m.root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  m.git('remote', 'add', 'origin', remote);
  m.git('push', '-q', 'origin', 'main');
  assert.equal(m.runWithInput({ JEROME_TEST_TTY: '1' }, 'demo\n', 'rules', 'unlock', 'push', m.dir).status, 0);
  writeFileSync(join(m.dir, 'page.md'), 'x\n');
  m.git('add', 'page.md');
  m.git('commit', '-q', '-m', 'Add the page');
  assert.equal(m.connect(d.url).status, 0);
  assert.equal(d.cli('approve', m.link().machine).status, 0);
  const token = d.cli('dashboard').stdout.match(/#([A-Za-z0-9_-]+)/)[1];
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const overview = async () => (await fetch(`${d.url}/api/overview`, { headers: auth })).json();
  const send = (body) => fetch(`${d.url}/api/order`, { method: 'POST', headers: auth, body: JSON.stringify(body) });

  // The first beat learns the Director's version; the next carries the rules, and the push asked on Telegram.
  m.beat();
  m.beat();
  const o = await overview();
  const p = o.projects[0];
  assert.deepEqual(p.unlocked.map((g) => g.name), ['push']);
  const ask = o.attention.find((a) => a.kind === 'push');
  assert.ok(ask, JSON.stringify(o.attention));
  assert.equal(ask.count, 1);
  assert.deepEqual(ask.subjects, ['Add the page']);
  assert.deepEqual(ask.choices.map((c) => c.name), ['go', 'no']);
  const head = execFileSync('git', ['rev-parse', 'main'], { cwd: m.dir, encoding: 'utf8' }).trim();
  assert.equal(ask.head, head.slice(0, 12));

  // Refused: another head, another action, a group not unlocked, and unlocking, which has no order.
  const where = { machine: p.machineCode, project: p.key };
  assert.equal((await send({ ...where, kind: 'push', head: '0123456789ab', action: 'go' })).status, 400);
  assert.equal((await send({ ...where, kind: 'push', head: ask.head, action: 'force' })).status, 400);
  assert.equal((await send({ ...where, kind: 'lock', group: 'deploy-fly' })).status, 400);
  assert.equal((await send({ ...where, kind: 'unlock', group: 'deploy-fly' })).status, 400);

  assert.equal((await send({ ...where, kind: 'push', head: ask.head, action: 'go' })).status, 201);
  assert.equal((await send({ ...where, kind: 'push', head: ask.head, action: 'go' })).status, 409);
  assert.ok(!(await overview()).attention.some((a) => a.kind === 'push'), 'gone from the page at once');
  m.beat();
  assert.equal(execFileSync('git', ['rev-parse', 'main'], { cwd: remote, encoding: 'utf8' }).trim(), head);
  const after = await overview();
  assert.equal(after.orders[0].status, 'done', JSON.stringify(after.orders[0]));
  assert.match(after.orders[0].result, /Pushed: main, 1 commit/);
  assert.ok(!after.attention.some((a) => a.kind === 'push'));
  // New commits after it: the page says they are new since that push, in the Mac's words (D197).
  writeFileSync(join(m.dir, 'page.md'), 'y\n');
  m.git('commit', '-q', '-am', 'Change the page');
  // Four hours later (D198).
  const pushState = join(dirname(sandboxDb(m.root, m.dir)), 'push.json');
  const ps = JSON.parse(readFileSync(pushState, 'utf8'));
  writeFileSync(pushState, JSON.stringify({ ...ps, last: new Date(Date.now() - 4 * H - 1000).toISOString() }));
  m.beat();
  m.beat();
  const again = (await overview()).attention.find((a) => a.kind === 'push');
  assert.ok(again, 'asked again');
  assert.match(again.text, /^1 new commit on main since the push at \d\d:\d\d:\n• Change the page/);

  // Lock again from the page: the Mac locks it, and the page shows it locked.
  assert.equal((await send({ ...where, kind: 'lock', group: 'push' })).status, 201);
  m.beat();
  assert.match(m.run('rules', m.dir).stdout, /push +locked/);
  m.beat();
  const last = await overview();
  assert.deepEqual(last.projects[0].unlocked, []);
  assert.match(last.orders[0].result, /push locked again/);
  const told = readFileSync(join(fake, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => c.method === 'sendMessage').map((c) => c.params.text);
  assert.ok(told.some((x) => /From the Director's dashboard: Pushed: main/.test(x)), told.join('\n---\n'));
  assert.ok(told.some((x) => /From the Director's dashboard: push locked again/.test(x)));
});

test('a Director from before 0.16.0 gets no rules from a Mac, and its orders table takes the new kinds once updated (D196)', () => {
  // The Mac sends rules only to a Director that said its version, 0.16.0 or later; an older one says none.
  assert.equal(atLeast(undefined, '0.16.0'), false);
  assert.equal(atLeast('0.15.9', '0.16.0'), false);
  assert.equal(atLeast('0.16.0', '0.16.0'), true);
  assert.equal(atLeast('1.0.0', '0.16.0'), true);
  const home = mkdtempSync(join(tmpdir(), 'jerome-director-old-'));
  const dir = join(home, '.local', 'share', 'jerome-director');
  mkdirSync(dir, { recursive: true });
  const old = new DatabaseSync(join(dir, 'director.db'));
  old.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, machine TEXT NOT NULL, project TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('answer', 'note', 'action')), ref INTEGER, action TEXT, text TEXT,
      created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'lapsed')),
      result TEXT, done_at TEXT);
    INSERT INTO orders (machine, project, kind, text, created_at) VALUES ('m', 'p', 'note', 'kept', '2026-10-31T00:00:00Z');`);
  old.close();
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { openDirectorDb } = await import(${JSON.stringify(join(import.meta.dirname, '..', 'src', 'director.js'))});
    const db = openDirectorDb({ HOME: ${JSON.stringify(home)} });
    db.prepare("INSERT INTO orders (machine, project, kind, action, text, created_at) VALUES ('m', 'p', 'push', 'go', 'abc', 'x')").run();
    console.log(JSON.stringify(db.prepare('SELECT kind, text FROM orders ORDER BY id').all()));`], { encoding: 'utf8', env: { ...process.env, HOME: home, XDG_DATA_HOME: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), [{ kind: 'note', text: 'kept' }, { kind: 'push', text: 'abc' }]);
});

// Step 3 (D148, D149, D201): the Director decides, from one database standing for what the Macs said.
test('the Director gives fill runs across the Macs, staggered, slots first; a silent Mac gets nothing and its permits lapse (D148, D201)', async () => {
  const { openDirectorDb } = await import('../src/director.js');
  const { decide, askSlot, permitsFor, saveSettings, decisions } = await import('../src/permits.js');
  const db = openDirectorDb({ XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'jerome-permits-')) });
  let t = Date.parse('2026-11-02T12:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  const reading = (used, at = t) => db.prepare('INSERT INTO readings (machine, read_at, data) VALUES (?, ?, ?)')
    .run('A', iso(at), JSON.stringify({ readAt: iso(at), windows: { seven_day: { used, resetsAt: (t + 3.5 * 24 * H) / 1000 }, five_hour: { used: 10, resetsAt: (t + 2 * H) / 1000 } }, scoped: [], breakdown: [] }));
  const beat = (machine) => db.prepare('UPDATE machines SET last_beat = ? WHERE id = ?').run(iso(t), machine);
  for (const id of ['A', 'B']) db.prepare("INSERT INTO machines (id, name, public_key, status, created_at) VALUES (?, ?, 'k', 'approved', ?)").run(id, id === 'A' ? 'mini' : 'm4', iso(t));
  const project = (machine, key, extra = {}) => db.prepare('INSERT OR REPLACE INTO projects (machine, key, name, data, updated_at) VALUES (?, ?, ?, ?, ?)').run(machine, key, key, JSON.stringify({
    key, name: key, fill: true, running: false, slots: [{ name: 'morning', at: '09:00' }], alerts: [], requests: [], overLimit: false,
    lastHeartbeat: null, usage: { today: { tokens: 0, usd: 0 }, week: { tokens: 0, usd: 0 } }, model: 'opus', maxMinutes: 60, ...extra }), iso(t));
  project('A', 'radar', { lastHeartbeat: { at: iso(t - 5 * H), status: 'done', reason: 'ok' } });
  project('B', 'climb', { lastHeartbeat: { at: iso(t - 9 * H), status: 'done', reason: 'ok' } });
  project('B', 'busy', { alerts: [{ id: 1, reason: 'stuck' }] });
  beat('A');
  beat('B');
  reading(20);

  // Off, as after an update: nothing is decided, a slot just runs.
  assert.deepEqual(decide(db, { now: t }), []);
  assert.deepEqual(askSlot(db, 'A', { project: 'radar', slot: 'morning' }, { now: t }), { go: true, mode: 'observing' });
  saveSettings(db, { on: true });

  // Behind the pace: one fill run, in the project whose last heartbeat is oldest, on whichever Mac; never the blocked one.
  const [first] = decide(db, { now: t });
  assert.equal(first.project, 'climb');
  const [permit] = permitsFor(db, 'B', t);
  assert.deepEqual(Object.keys(permit), ['id', 'project', 'kind', 'model', 'maxMinutes', 'expiresAt']);
  assert.deepEqual([permit.kind, permit.model, permit.maxMinutes], ['fill', 'opus', 60]);
  assert.deepEqual(permitsFor(db, 'A', t), []);
  // Staggered: not within 5 minutes, nor before a reading taken since.
  t += 2 * 60_000;
  assert.deepEqual(decide(db, { now: t }), []);
  t += 4 * 60_000;
  beat('A');
  beat('B');
  assert.deepEqual(decide(db, { now: t }), [], 'no reading since the last fill run');
  reading(21);
  assert.equal(decide(db, { now: t })[0].project, 'radar');
  // The first permit was never started: it lapsed after 3 minutes.
  assert.equal(db.prepare('SELECT status FROM permits WHERE id = ?').get(permit.id).status, 'lapsed');

  // At the reserve a slot is queued, with no permit, and granted at a beat once there is room, before any fill run.
  reading(85, t + 1000);
  const q = askSlot(db, 'B', { project: 'climb', slot: 'morning' }, { now: t + 2000 });
  assert.equal(q.go, false);
  assert.match(q.why, /kept for you/);
  assert.equal(decisions(db, t).queued.length, 1);
  t += 10 * 60_000;
  beat('A');
  beat('B');
  reading(30);
  const granted = decide(db, { now: t });
  assert.deepEqual(granted.map((g) => [g.kind, g.project]), [['slot', 'climb']]);
  assert.deepEqual(permitsFor(db, 'B', t).map((p) => [p.kind, p.slot]), [['slot', 'morning']]);
  // A slot asking while its project has a permit going is queued too, then dropped after 6 hours if never granted.
  assert.equal(askSlot(db, 'B', { project: 'climb', slot: 'morning' }, { now: t }).queued, true);
  // A Mac silent for over 5 minutes is given nothing; the other goes on.
  t += 31 * 60_000;
  beat('A');
  reading(31);
  db.prepare("UPDATE permits SET status = 'ended'").run();
  db.prepare("UPDATE queue SET status = 'dropped'").run();
  project('A', 'radar', { lastHeartbeat: { at: iso(t - 40 * 60_000), status: 'done', reason: 'ok' } });
  const given = decide(db, { now: t });
  assert.deepEqual(given.map((g) => g.project), ['radar']);
  // A slot that asks with room gets its go at once, as a started permit.
  t += 6 * 60_000;
  const go = askSlot(db, 'A', { project: 'radar', slot: 'evening-unknown' }, { now: t });
  assert.equal(go.go, true, 'a slot the Director has not heard of runs');
  db.close();
});

test('a Mac directed by the Director runs its permit as a fill run, a slot at the reserve waits queued with no alert, and with the Director silent it goes back to local mode (D148, D149)', async () => {
  const d = await startDirector();
  const m = mac('mini', { FAKE_TRIAGE: '{"work": true, "task": "Add tests for the parser"}', JEROME_FILL_SYNC: '1' });
  const marker = join(m.dir, '.jerome', 'project.json');
  const kept = JSON.parse(readFileSync(marker, 'utf8'));
  writeFileSync(marker, `${JSON.stringify({ ...kept, heartbeat: { ...kept.heartbeat, slots: [{ name: 'morning', at: ['09:00'] }] } }, null, 2)}\n`);
  m.git('add', '.jerome/project.json');
  m.git('commit', '-q', '-m', 'settings');
  assert.equal(m.connect(d.url).status, 0);
  assert.equal(d.cli('approve', m.link().machine).status, 0);
  assert.equal(m.runIn(m.dir, 'governor', 'add').status, 0);
  // Two beats: the first tells the Mac the Director's version, so the second carries the project's model and length.
  m.beat();
  m.beat();
  assert.match(m.jerome('connect', 'status').stdout, /mode {5}the Director only observes/);
  assert.match(d.cli('settings', 'on', '--reserve', '25').stdout, /Deciding[\s\S]*25% kept for you/);
  m.beat();
  assert.match(m.watchdogLog(), /director: directing this Mac[\s\S]*director: permit \d+: fill run in demo/);
  const runs = () => {
    const db = m.db();
    const rows = db.prepare('SELECT status, reason, fill, slot FROM runs ORDER BY id').all();
    db.close();
    return rows;
  };
  assert.equal(runs().length, 1);
  assert.equal(runs()[0].fill, 1);
  assert.equal(runs()[0].status, 'done', runs()[0].reason);
  assert.match(m.jerome('connect', 'status').stdout, /mode {5}directed: fill runs and slots on the Director's permits/);
  assert.match(d.cli('status').stdout, /pace {5}go: 7d 6% behind its pace[\s\S]*reserve 25%/);

  // At the reserve, the slot's run asks and is queued: no alert, a reason that says so.
  const endpoint = join(m.root, 'usage.json');
  writeFileSync(endpoint, JSON.stringify({ five_hour: { utilization: 10, resets_at: new Date(Date.now() + 2 * H).toISOString() }, seven_day: { utilization: 90, resets_at: new Date(Date.now() + 2 * 24 * H).toISOString() }, limits: [], seven_day_breakdown: { rows: [] } }));
  m.jerome('quota');
  m.beat();
  m.jerome('heartbeat', 'run', 'morning', m.dir);
  const queued = runs().at(-1);
  assert.equal(queued.status, 'blocked');
  assert.match(queued.reason, /^governor: queued by the Director, 7d 90% ≥ 75%: the rest is kept for you/);
  const db = m.db();
  assert.equal(db.prepare("SELECT count(*) n FROM alerts WHERE status = 'open'").get().n, 0);
  db.close();
  assert.match(d.cli('status').stdout, /queued morning of demo/);
  const overview = d.db();
  assert.equal(overview.prepare("SELECT count(*) n FROM queue WHERE status = 'waiting'").get().n, 1);
  overview.close();

  // A permit the Mac did not accept is refused by the run itself.
  const forged = m.jerome('heartbeat', 'fill', m.dir, '--permit', '999');
  assert.equal(forged.status, 0);
  assert.match(runs().at(-1).reason, /director: permit 999 is not one this Mac accepted/);

  // The Director silent for more than 5 minutes: local mode, said once.
  const state = join(m.root, '.cache', 'jerome', 'director', 'state.json');
  const s = JSON.parse(readFileSync(state, 'utf8'));
  writeFileSync(state, JSON.stringify({ ...s, lastOk: new Date(Date.now() - 10 * 60_000).toISOString() }));
  writeFileSync(join(m.root, '.config', 'jerome', 'director.json'), JSON.stringify({ ...m.link(), url: 'http://127.0.0.1:9/' }));
  m.beat();
  assert.match(m.watchdogLog(), /director: no answer for 5 minutes: local mode/);
  assert.match(m.jerome('connect', 'status').stdout, /mode {5}local since/);
});

// Step 5 (D155, D202): one bot, on the Director, for every Mac.
test('with the bot on the Director, a Mac\'s question reaches Telegram with its beat, a tap goes back as an order the Mac runs, and its own bridge stays quiet (D202)', async () => {
  const fake = mkdtempSync(join(tmpdir(), 'jerome-tg-'));
  const d = await startDirector({ extra: { JEROME_TELEGRAM_FAKE: fake }, before: (home) => {
    writeFileSync(join(home, '.local', 'share', 'jerome-director', 'telegram.json'), JSON.stringify({ token: '1:x', chatId: 7, chat: 'Fabio', bot: 'jerome_test_bot' }), { mode: 0o600 });
  } });
  // The Mac had its own bridge, on a bot of its own: it goes quiet.
  const own = mkdtempSync(join(tmpdir(), 'jerome-tg-mac-'));
  const m = mac('mini', { JEROME_TELEGRAM_FAKE: own });
  mkdirSync(join(m.root, '.config', 'jerome'), { recursive: true });
  writeFileSync(join(m.root, '.config', 'jerome', 'telegram.json'), JSON.stringify({ token: '2:y', chatId: 7, chat: 'Fabio', bot: 'old_bot' }));
  assert.equal(m.connect(d.url).status, 0);
  assert.equal(d.cli('approve', m.link().machine).status, 0);
  m.beat();
  assert.match(m.watchdogLog(), /director: Telegram is on the Director/);
  assert.match(d.cli('telegram', 'status').stdout, /Telegram: @jerome_test_bot, heard only from Fabio · for every Mac's projects/);

  const calls = () => (existsSync(join(fake, 'calls.jsonl')) ? readFileSync(join(fake, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const sent = () => calls().filter((c) => c.method === 'sendMessage').map((c) => c.params);
  const until = async (what, check) => {
    for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(check(), `${what}; the Director said: ${d.log()}`);
  };
  assert.equal(m.runIn(m.dir, 'request', 'open', '--question', 'Which host?', '--options', 'A) Fly.io / B) Render', '--recommendation', 'A').status, 0);
  m.beat();
  await until('the question sent by the Director', () => sent().some((x) => /Which host/.test(x.text)));
  const question = sent().find((x) => /Which host/.test(x.text));
  assert.deepEqual(question.reply_markup.inline_keyboard.map((r) => r[0].text), ['A) Fly.io', 'B) Render']);
  assert.match(question.text, /^<b>demo<\/b>/);
  const db = d.db();
  const { message_id: mid, request } = db.prepare('SELECT message_id, request FROM tg_sent WHERE request IS NOT NULL').get();
  db.close();

  // A tap on B: an order for the Mac, its buttons taken off, and no message: that is the answer (D205).
  writeFileSync(join(fake, 'updates.json'), JSON.stringify([{ update_id: 1, callback_query: { id: 'q1', data: `a:${request}:1`, message: { message_id: mid, chat: { id: 7, type: 'private' } } } }]));
  await until('the buttons taken off', () => calls().some((c) => c.method === 'editMessageReplyMarkup' && c.params.message_id === mid));
  // The Mac's next beat runs it, and the Director tells nothing more once it went through.
  m.beat();
  const project = m.db();
  assert.equal(project.prepare('SELECT status FROM requests WHERE id = ?').get(request).status, 'answered');
  project.close();
  const toldOf = () => { const x = d.db(); const r = x.prepare("SELECT told FROM orders WHERE via = 'telegram'").all(); x.close(); return r; };
  await until('the outcome recorded as told', () => toldOf().length && toldOf().every((o) => o.told));
  assert.ok(!sent().some((x) => /sent to mini|answered: B\) Render/.test(x.text)), 'nothing told for what went through');
  assert.ok(!sent().some((x) => /From the Director's dashboard/.test(x.text)), 'no echo for the user\'s own tap');

  // A note by the project's name, then /status.
  writeFileSync(join(fake, 'updates.json'), JSON.stringify([
    { update_id: 2, message: { message_id: 50, chat: { id: 7, type: 'private' }, text: '#demo the pricing page needs the free plan' } },
    { update_id: 3, message: { message_id: 51, chat: { id: 7, type: 'private' }, text: '/status' } },
    { update_id: 4, message: { message_id: 52, chat: { id: 99, type: 'private' }, text: '#demo from a stranger' } },
  ]));
  await until('the status told', () => sent().some((x) => /Nothing waits for you in 1 project/.test(x.text)));
  assert.deepEqual(calls().filter((c) => c.method === 'setMessageReaction').map((c) => c.params.message_id), [50], 'the note placed gets a reaction');
  m.beat();
  const notes = m.db();
  assert.deepEqual(notes.prepare('SELECT text FROM notes').all().map((n) => n.text), ['the pricing page needs the free plan']);
  notes.close();

  // A note from the dashboard: told by the bot with two buttons, was it you (D206).
  const token = d.cli('dashboard').stdout.match(/#([A-Za-z0-9_-]+)/)[1];
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const board = await (await fetch(`${d.url}/api/overview`, { headers: auth })).json();
  const order = await fetch(`${d.url}/api/order`, { method: 'POST', headers: auth, body: JSON.stringify({ machine: board.projects[0].machineCode, project: board.projects[0].key, kind: 'note', text: 'check the SEO every two days' }) });
  assert.equal(order.status, 201);
  m.beat();
  m.beat();
  await until('the echo sent with its buttons', () => sent().some((x) => /From the Director's dashboard: note N\d+: check the SEO/.test(x.text)));
  const echo = sent().find((x) => /From the Director's dashboard: note/.test(x.text));
  assert.match(echo.text, /<i>Was it you\?<\/i>$/);
  assert.doesNotMatch(echo.text, /--new-token/);
  const [[me], [notMe]] = echo.reply_markup.inline_keyboard;
  assert.deepEqual([me.text, notMe.text], ['Yes, it was me', 'No, it was not me']);
  const echoId = calls().findIndex((c) => c.method === 'sendMessage' && c.params.text === echo.text) + 1001;
  // No: a new token at once, the old address refused, the new one said.
  writeFileSync(join(fake, 'updates.json'), JSON.stringify([{ update_id: 10, callback_query: { id: 'q9', data: notMe.callback_data, message: { message_id: echoId, chat: { id: 7, type: 'private' } } } }]));
  await until('the new token told', () => sent().some((x) => /The dashboard has a new token/.test(x.text)));
  assert.ok(calls().some((c) => c.method === 'editMessageReplyMarkup' && c.params.message_id === echoId), 'its buttons taken off');
  const fresh = d.cli('dashboard').stdout.match(/#([A-Za-z0-9_-]+)/)[1];
  assert.notEqual(fresh, token);
  assert.ok(sent().find((x) => /new token/.test(x.text)).text.includes(`#${fresh}`));
  assert.equal((await fetch(`${d.url}/api/overview`, { headers: auth })).status, 403);
  // The Mac's own bot was never called: one bot, one machine.
  assert.ok(!existsSync(join(own, 'calls.jsonl')));
  // Off on the Director: the Mac's own bridge speaks again.
  assert.match(d.cli('telegram', 'off').stdout, /Telegram is off on the Director/);
  m.beat();
  assert.match(m.watchdogLog(), /director: Telegram is not on the Director/);
});

test('a note a run wrote goes with its board line to the Director once, opens on the dashboard and is read on Telegram with /note (D207)', async () => {
  const fake = mkdtempSync(join(tmpdir(), 'jerome-tg-'));
  const d = await startDirector({ extra: { JEROME_TELEGRAM_FAKE: fake }, before: (home) => {
    writeFileSync(join(home, '.local', 'share', 'jerome-director', 'telegram.json'), JSON.stringify({ token: '1:x', chatId: 7, chat: 'Fabio', bot: 'jerome_test_bot' }), { mode: 0o600 });
  } });
  const m = mac('mini');
  assert.equal(m.connect(d.url).status, 0);
  assert.equal(d.cli('approve', m.link().machine).status, 0);
  mkdirSync(join(m.dir, '.jerome', 'notes'), { recursive: true });
  writeFileSync(join(m.dir, '.jerome', 'notes', '2026-11-06-visibility.md'), `# AI visibility\n\n- robots open\n  - bots 200, checked from ${m.root}/check.sh\n- three moves\n`);
  writeFileSync(join(m.dir, '.jerome', 'digest.md'), '# Digest\n\n- 2026-11-06 08:47 · main · visibility check, note notes/2026-11-06-visibility.md with 3 moves · agent/vis · R22\n- 2026-11-06 09:16 · main · index check, 17/17 indexed · agent/idx · none\n');
  // The first beat learns the Director's version; the next carries the note.
  m.beat();
  m.beat();
  const token = d.cli('dashboard').stdout.match(/#([A-Za-z0-9_-]+)/)[1];
  const auth = { authorization: `Bearer ${token}` };
  const o = await (await fetch(`${d.url}/api/overview`, { headers: auth })).json();
  const [last, first] = o.projects[0].board.done;
  assert.deepEqual(last.notes, [], 'a line that names no note');
  assert.equal(first.notes.length, 1);
  assert.equal(first.notes[0].name, '2026-11-06-visibility.md');
  assert.equal((await fetch(`${d.url}/api/note?id=${first.notes[0].id}`)).status, 403, 'only with the token');
  const note = await (await fetch(`${d.url}/api/note?id=${first.notes[0].id}`, { headers: auth })).json();
  assert.match(note.text, /^# AI visibility\n\n- robots open\n {2}- bots 200, checked from …\/check\.sh\n/, 'its lines and indent kept');
  assert.ok(!note.text.includes(m.root), 'no path leaves the Mac');
  assert.equal(note.project, 'demo');
  // Sent once: unchanged, the next beat leaves it out; changed, it goes again.
  const updated = () => { const x = d.db(); const r = x.prepare('SELECT updated_at FROM notes').get().updated_at; x.close(); return r; };
  const was = updated();
  m.beat();
  assert.equal(updated(), was);
  writeFileSync(join(m.dir, '.jerome', 'notes', '2026-11-06-visibility.md'), '# AI visibility\n\nfour moves now\n');
  m.beat();
  assert.notEqual(updated(), was);

  // On Telegram: /note lists it, a tap sends its text.
  const calls = () => (existsSync(join(fake, 'calls.jsonl')) ? readFileSync(join(fake, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const sent = () => calls().filter((c) => c.method === 'sendMessage').map((c) => c.params);
  const until = async (what, check) => {
    for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(check(), `${what}; the Director said: ${d.log()}`);
  };
  writeFileSync(join(fake, 'updates.json'), JSON.stringify([{ update_id: 1, message: { message_id: 60, chat: { id: 7, type: 'private' }, text: '/note' } }]));
  await until('the notes listed', () => sent().some((x) => /The latest notes the runs wrote/.test(x.text)));
  const [[button]] = sent().find((x) => /The latest notes/.test(x.text)).reply_markup.inline_keyboard;
  assert.equal(button.text, '📄 demo · 2026-11-06-visibility');
  writeFileSync(join(fake, 'updates.json'), JSON.stringify([{ update_id: 2, callback_query: { id: 'q1', data: button.callback_data, message: { message_id: 1001, chat: { id: 7, type: 'private' } } } }]));
  await until('the note sent', () => sent().some((x) => /^📄 demo · 2026-11-06-visibility\.md\n\n# AI visibility\n\nfour moves now/.test(x.text)));
});
