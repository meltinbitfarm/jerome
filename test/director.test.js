// Jérôme Director, step 1 (D145-D154): a real Director process on loopback, Macs as throwaway sandboxes, and the
// requests a forger, a replayer or a revoked Mac would send.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

function mac(name) {
  const p = readyProject({ JEROME_NOTIFY: 'off' });
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
  const big = 'x'.repeat(70 * 1024);
  assert.equal((await post(signed({ body: big }), big)).status, 413);
  assert.equal((await fetch(`${d.url}/v1/anything`)).status, 404);
  assert.match(d.log(), /refused \/v1\/beat from [0-9A-F-]+: request replayed/);
});

test('the dashboard is a page under a strict policy, its data only with the token, and nothing it answers writes', async () => {
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
