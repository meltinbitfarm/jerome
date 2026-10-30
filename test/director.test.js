// Jérôme Director, step 1 (D145-D154): a real Director process on loopback, Macs as throwaway sandboxes, and the
// requests a forger, a replayer or a revoked Mac would send.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { privateAddress, parseListen, checkListen, checkShape } from '../src/director.js';
import { newKeys, signRequest, verifyResponse } from '../src/sign.js';
import { scrub } from '../src/scrub.js';
import { readyProject } from './sandbox.js';

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

async function startDirector() {
  const home = mkdtempSync(join(tmpdir(), 'jerome-director-'));
  const port = await freePort();
  const env = { PATH: process.env.PATH, HOME: home };
  const cli = (...args) => spawnSync(process.execPath, [BIN, 'director', ...args], { env, encoding: 'utf8' });
  const init = cli('init', '--listen', `127.0.0.1:${port}`);
  assert.equal(init.status, 0, init.stderr);
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
