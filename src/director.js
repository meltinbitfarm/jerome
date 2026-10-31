// Jérôme Director, the coordinator of every Mac that runs Jérôme with the same Claude account (docs/specs/director.md,
// D145-D155). Step 1: it sees. Macs connect with `jerome connect`, Fabio approves each one, and every minute each
// approved Mac's watchdog sends a signed beat with the quota it read, its projects and its finished runs, which the
// Director keeps. It never reaches a Mac: it only answers, and every answer is signed (D146). It listens on one VPN or
// private address, never on a public one (D145), and holds no credential of anyone's (D139, D147).
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { newKeys, fingerprint, sameCode, verifyRequest, signResponse, NONCE_MS } from './sign.js';
import { VERSION } from './template.js';
import { serveDashboard, takeOrder, ORDER_BODY } from './dashboard.js';

export const DEFAULT_PORT = 7788;
// A beat with boards (D177) is larger than one without.
const MAX_BODY = 256 * 1024;
const RATE_PER_MIN = 20;
const MAX_PENDING = 5;
const KEEP_DAYS = 90;
// An order from the dashboard the Mac has not taken by then lapses (D169).
export const ORDER_MS = 10 * 60_000;

export function directorHome(env = process.env) {
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'jerome-director');
}
const configFile = (env) => join(directorHome(env), 'director.json');
const pidFile = (env) => join(directorHome(env), 'director.pid');

// The addresses the Director may listen on (D145): loopback, the private ranges, the range VPNs share (Tailscale's
// 100.64/10) and IPv6 unique local addresses. Never all interfaces, never a public address.
export function privateAddress(host) {
  const v = isIP(host);
  if (v === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const h = host.toLowerCase();
    return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h);
  }
  return false;
}

// "100.101.102.103:7788", "[fd7a::1]:7788" or an address alone, as { host, port }, or { error }.
export function parseListen(text) {
  const m = String(text ?? '').match(/^(?:\[([0-9a-fA-F:]+)\]|([0-9.]+|[0-9a-fA-F:]+?))(?::(\d+))?$/);
  if (!m) return { error: `${text} is not an address: give the server's VPN address, such as 100.101.102.103 or 10.0.0.1:7788` };
  const host = m[1] ?? m[2];
  const port = m[3] ? Number(m[3]) : DEFAULT_PORT;
  if (!isIP(host)) return { error: `${host} is not an IP address` };
  if (port < 0 || port > 65535) return { error: `${port} is not a port` };
  return { host, port };
}

// Whether the Director may listen there (D145, D153). In a container it listens on all of the container's interfaces,
// and compose publishes the port on DIRECTOR_ADDRESS only, which must then be private.
export function checkListen({ host }, env = process.env) {
  if (host === '0.0.0.0' || host === '::') {
    const published = env.DIRECTOR_ADDRESS;
    if (!published) return 'The Director never listens on every interface: give the server\'s VPN address. (In Docker, compose publishes it on DIRECTOR_ADDRESS, which is missing.)';
    if (!privateAddress(published)) return `DIRECTOR_ADDRESS ${published} is a public address: give the server's VPN address.`;
    return null;
  }
  if (!privateAddress(host)) return `${host} is a public address: the Director listens only on a VPN or private address (100.64-127.x, 10.x, 172.16-31.x, 192.168.x, fc00::/7, loopback).`;
  return null;
}

export function readDirectorConfig(env = process.env) {
  try {
    return JSON.parse(readFileSync(configFile(env), 'utf8'));
  } catch {
    return null;
  }
}

function writeDirectorConfig(config, env) {
  mkdirSync(directorHome(env), { recursive: true, mode: 0o700 });
  chmodSync(directorHome(env), 0o700);
  writeFileSync(configFile(env), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configFile(env), 0o600);
}

// The setup, made once: the Director's keys, the dashboard's token and the address. Later calls only change the address,
// and give a token to a Director set up before the dashboard.
function setup(listen, env) {
  const existing = readDirectorConfig(env);
  if (existing) {
    const changed = { ...existing, listen: listen ?? existing.listen, dashboardToken: existing.dashboardToken ?? randomBytes(18).toString('base64url') };
    if (changed.listen !== existing.listen || changed.dashboardToken !== existing.dashboardToken) writeDirectorConfig(changed, env);
    return { config: readDirectorConfig(env), created: false };
  }
  const config = { listen, key: newKeys(), dashboardToken: randomBytes(18).toString('base64url'), createdAt: new Date().toISOString() };
  writeDirectorConfig(config, env);
  return { config, created: true };
}

export function openDirectorDb(env = process.env) {
  mkdirSync(directorHome(env), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directorHome(env), 'director.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS machines (id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'revoked')), created_at TEXT NOT NULL, approved_at TEXT,
      revoked_at TEXT, last_beat TEXT, version TEXT);
    CREATE TABLE IF NOT EXISTS projects (machine TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY (machine, key));
    CREATE TABLE IF NOT EXISTS readings (id INTEGER PRIMARY KEY, machine TEXT NOT NULL, read_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS readings_at ON readings (read_at);
    CREATE TABLE IF NOT EXISTS runs (machine TEXT NOT NULL, project TEXT NOT NULL, run_id INTEGER NOT NULL, ended_at TEXT,
      data TEXT NOT NULL, PRIMARY KEY (machine, project, run_id));
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS boards (machine TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (machine, key));
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, machine TEXT NOT NULL, project TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('answer', 'note', 'action', 'push', 'lock')), ref INTEGER, action TEXT, text TEXT,
      created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'lapsed')),
      result TEXT, done_at TEXT);
    CREATE INDEX IF NOT EXISTS orders_open ON orders (machine, status);`);
  // The push and the locking from the dashboard (D196): a table from before them is copied into one that takes them.
  if (!/'push'/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'orders'").get()?.sql ?? "'push'")) {
    db.exec(`BEGIN;
      CREATE TABLE orders_new (id INTEGER PRIMARY KEY, machine TEXT NOT NULL, project TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('answer', 'note', 'action', 'push', 'lock')), ref INTEGER, action TEXT, text TEXT,
        created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'lapsed')),
        result TEXT, done_at TEXT);
      INSERT INTO orders_new SELECT id, machine, project, kind, ref, action, text, created_at, status, result, done_at FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_new RENAME TO orders;
      CREATE INDEX IF NOT EXISTS orders_open ON orders (machine, status);
      COMMIT;`);
  }
  // Added with the dashboard in the user's language (D163).
  if (!db.prepare('PRAGMA table_info(machines)').all().some((c) => c.name === 'language')) db.exec('ALTER TABLE machines ADD COLUMN language TEXT');
  return db;
}

// The shapes the Director accepts (D146, D147): any other field, a longer text or a longer list refuses the request.
// 'string:N' is a text of at most N characters; a key ending in ? may be missing or null.
const WINDOW = { used: 'number', 'resetsAt?': 'number', 'readAt?': 'string:40', 'source?': 'string:20' };
const POINTS = { 'five_hour?': 'number', 'seven_day?': 'number' };
const USAGE = { tokens: 'number', usd: 'number' };
// A project's board (D177): texts only, each cut on the Mac.
const ITEM = { 'id?': 'string:12', text: 'string:600', 'kind?': 'string:12', 'at?': 'string:40' };
const BOARD = {
  key: 'string:120',
  'now?': { startedAt: 'string:40', 'task?': 'string:600', agents: [{ name: 'string:60', 'what?': 'string:600', status: 'string:20' }, 20] },
  'last?': { at: 'string:40', text: 'string:600' },
  todo: [ITEM, 60], done: [ITEM, 15], closed: [ITEM, 20], parked: [ITEM, 20],
  // The texts not rewritten in plain words yet, left out until they are.
  'pending?': 'number',
};
const RESULT = { id: 'number', ok: 'boolean', text: 'string:300' };
const SHAPES = {
  hello: { name: 'string:60', publicKey: 'string:400', version: 'string:20' },
  beat: {
    version: 'string:20',
    at: 'string:40',
    // The user's language on that Mac (D162), for the dashboard.
    'language?': 'string:5',
    'quota?': {
      readAt: 'string:40',
      windows: { 'five_hour?': WINDOW, 'seven_day?': WINDOW },
      scoped: [{ model: 'string:60', used: 'number', 'resetsAt?': 'number' }, 10],
      breakdown: [{ key: 'string:40', name: 'string:60', percent: 'number' }, 10],
    },
    projects: [{
      key: 'string:120', name: 'string:100', fill: 'boolean', running: 'boolean',
      slots: [{ name: 'string:40', at: 'string:200' }, 20],
      alerts: [{ id: 'number', reason: 'string:300', 'count?': 'number', 'openedAt?': 'string:40' }, 50],
      requests: [{ id: 'number', question: 'string:300', 'options?': 'string:300', 'recommendation?': 'string:300' }, 50],
      overLimit: 'boolean',
      'lastHeartbeat?': { at: 'string:40', status: 'string:20', reason: 'string:300' },
      usage: { today: USAGE, week: USAGE },
      // What the user unlocked in the project, and the push asked and not answered (D194-D196).
      'rules?': { unlocked: ['string:20', 20], 'push?': { head: 'string:12', branch: 'string:60', count: 'number', subjects: ['string:120', 5], 'after?': { 'day?': 'string:5', time: 'string:5' } } },
    }, 100],
    runs: [{
      project: 'string:120', id: 'number', kind: 'string:10', 'model?': 'string:60', startedAt: 'string:40', 'endedAt?': 'string:40',
      status: 'string:20', reason: 'string:300', 'quota?': { before: POINTS, after: POINTS },
    }, 50],
    'boards?': [BOARD, 100],
    // What the Mac did with the dashboard's orders (D191), when its quick report did not get through.
    'results?': [RESULT, 50],
  },
  results: { results: [RESULT, 50] },
};

export function checkShape(value, shape, at = 'body') {
  if (typeof shape === 'string') {
    const [kind, max] = shape.split(':');
    if (kind === 'string') return typeof value === 'string' && value.length <= Number(max) ? null : `${at} must be a text of at most ${max} characters`;
    if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? null : `${at} must be a number`;
    if (kind === 'boolean') return typeof value === 'boolean' ? null : `${at} must be true or false`;
  }
  if (Array.isArray(shape)) {
    const [item, max] = shape;
    if (!Array.isArray(value) || value.length > max) return `${at} must be a list of at most ${max}`;
    for (const [i, x] of value.entries()) {
      const e = checkShape(x, item, `${at}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${at} must be an object`;
  const keys = new Map(Object.keys(shape).map((k) => [k.replace(/\?$/, ''), k]));
  for (const k of Object.keys(value)) if (!keys.has(k)) return `${at}.${k} is not a field the Director knows`;
  for (const [name, key] of keys) {
    if (value[name] === undefined || value[name] === null) {
      if (key.endsWith('?')) continue;
      return `${at}.${name} is missing`;
    }
    const e = checkShape(value[name], shape[key], `${at}.${name}`);
    if (e) return e;
  }
  return null;
}

class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The Director's requests, apart from the HTTP server: what each route does with a request already read.
export function directorApp({ env = process.env, log = () => {}, now = () => Date.now() } = {}) {
  const config = readDirectorConfig(env);
  const db = openDirectorDb(env);
  const recent = new Map();

  const nonceSeen = (nonce, at) => {
    db.prepare('DELETE FROM nonces WHERE at < ?').run(at - NONCE_MS);
    try {
      db.prepare('INSERT INTO nonces (nonce, at) VALUES (?, ?)').run(nonce, at);
      return false;
    } catch {
      return true;
    }
  };
  const tooMany = (machine, at) => {
    const times = (recent.get(machine) ?? []).filter((t) => t > at - 60_000);
    times.push(at);
    recent.set(machine, times);
    return times.length > RATE_PER_MIN;
  };
  // The request is the Mac's own, and new.
  const authentic = (req, publicPem) => {
    const at = now();
    const bad = verifyRequest({ method: req.method, path: req.path, body: req.body, headers: req.headers, publicPem, now: at });
    if (bad) throw new Refusal(401, bad);
    if (nonceSeen(req.headers['x-jerome-nonce'], at)) throw new Refusal(401, 'request replayed');
    if (tooMany(req.headers['x-jerome-machine'], at)) throw new Refusal(429, 'too many requests');
  };
  const parse = (req, shape) => {
    let body;
    try {
      body = JSON.parse(req.body);
    } catch {
      throw new Refusal(400, 'the body is not JSON');
    }
    const wrong = checkShape(body, shape);
    if (wrong) throw new Refusal(400, wrong);
    return body;
  };

  // A Mac says hello with its public key: a new one waits for Fabio's approval (D146).
  const hello = (req) => {
    const body = parse(req, SHAPES.hello);
    let id;
    try {
      id = fingerprint(body.publicKey);
    } catch {
      throw new Refusal(400, 'body.publicKey is not a public key');
    }
    if (req.headers['x-jerome-machine'] !== id) throw new Refusal(401, 'the machine id is not its key\'s fingerprint');
    authentic(req, body.publicKey);
    const at = new Date(now()).toISOString();
    const director = { publicKey: config.key.public, fingerprint: fingerprint(config.key.public) };
    const known = db.prepare('SELECT status FROM machines WHERE id = ?').get(id);
    if (known?.status === 'revoked') throw new Refusal(403, 'this Mac was revoked');
    if (known) {
      db.prepare('UPDATE machines SET name = ?, version = ? WHERE id = ?').run(body.name, body.version, id);
      return { status: 200, body: { status: known.status, code: id, director } };
    }
    // A pending Mac of the same name is the same Mac connecting again with a new key: only the latest waits.
    db.prepare("DELETE FROM machines WHERE status = 'pending' AND (created_at < ? OR name = ?)").run(new Date(now() - 86_400_000).toISOString(), body.name);
    if (db.prepare("SELECT count(*) n FROM machines WHERE status = 'pending'").get().n >= MAX_PENDING) throw new Refusal(429, 'too many Macs waiting for approval');
    db.prepare("INSERT INTO machines (id, name, public_key, status, created_at, version) VALUES (?, ?, ?, 'pending', ?, ?)").run(id, body.name, body.publicKey, at, body.version);
    log(`${body.name} asks to connect: approve it with \`jerome director approve ${id}\``);
    return { status: 202, body: { status: 'pending', code: id, director } };
  };

  // A beat from an approved Mac: what it says is kept as it is, for the dashboard and the decisions to come.
  const beat = (req) => {
    const id = req.headers['x-jerome-machine'];
    const machine = id ? db.prepare('SELECT id, public_key, status FROM machines WHERE id = ?').get(id) : null;
    if (!machine) throw new Refusal(401, 'unknown Mac: run `jerome connect` again');
    authentic(req, machine.public_key);
    if (machine.status !== 'approved') throw new Refusal(403, machine.status === 'pending' ? 'waiting for approval' : 'this Mac was revoked');
    const body = parse(req, SHAPES.beat);
    const at = new Date(now()).toISOString();
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE machines SET last_beat = ?, version = ?, language = coalesce(?, language) WHERE id = ?').run(at, body.version, body.language ?? null, id);
      db.prepare('DELETE FROM projects WHERE machine = ?').run(id);
      for (const p of body.projects) db.prepare('INSERT OR REPLACE INTO projects (machine, key, name, data, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, p.key, p.name, JSON.stringify(p), at);
      if (body.quota && !db.prepare('SELECT 1 FROM readings WHERE machine = ? AND read_at = ?').get(id, body.quota.readAt)) {
        db.prepare('INSERT INTO readings (machine, read_at, data) VALUES (?, ?, ?)').run(id, body.quota.readAt, JSON.stringify(body.quota));
      }
      for (const b of body.boards ?? []) db.prepare('INSERT OR REPLACE INTO boards (machine, key, data, updated_at) VALUES (?, ?, ?, ?)').run(id, b.key, JSON.stringify(b), at);
      // A project the Mac no longer has takes its board with it.
      const keys = body.projects.map((p) => p.key);
      db.prepare(`DELETE FROM boards WHERE machine = ? AND key NOT IN (${keys.map(() => '?').join(', ') || "''"})`).run(id, ...keys);
      for (const r of body.runs) db.prepare('INSERT OR REPLACE INTO runs (machine, project, run_id, ended_at, data) VALUES (?, ?, ?, ?, ?)').run(id, r.project, r.id, r.endedAt ?? null, JSON.stringify(r));
      record(id, body.results ?? [], at);
      const old = new Date(now() - KEEP_DAYS * 86_400_000).toISOString();
      db.prepare('DELETE FROM readings WHERE read_at < ?').run(old);
      db.prepare('DELETE FROM runs WHERE ended_at < ?').run(old);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    // Step 1: the Director only sees. Permits come with step 3. The dashboard's orders for this Mac go with the answer
    // (D169, D191): data the Mac checks and runs under its own rules, never a command.
    // Its version tells the Mac which fields it knows (D196).
    return { status: 200, body: { ok: true, mode: 'observing', permits: [], orders: ordersFor(id), version: VERSION } };
  };

  // The orders waiting for a Mac, given again at each beat until it reports them; older than ORDER_MS they lapse.
  const ordersFor = (machine) => {
    const at = now();
    db.prepare("UPDATE orders SET status = 'lapsed', done_at = ? WHERE status = 'pending' AND created_at < ?").run(new Date(at).toISOString(), new Date(at - ORDER_MS).toISOString());
    return db.prepare("SELECT id, project, kind, ref, action, text, created_at FROM orders WHERE machine = ? AND status = 'pending' ORDER BY id LIMIT 20").all(machine)
      .map((o) => ({ id: o.id, project: o.project, kind: o.kind, ref: o.ref ?? null, action: o.action ?? null, text: o.text ?? null, at: o.created_at }));
  };
  // What a Mac did with its orders: only its own, and only once.
  const record = (machine, results, at) => {
    for (const r of results) {
      db.prepare("UPDATE orders SET status = ?, result = ?, done_at = ? WHERE id = ? AND machine = ? AND status IN ('pending', 'lapsed')")
        .run(r.ok ? 'done' : 'failed', r.text, at, r.id, machine);
    }
  };
  // A Mac's quick report, right after it ran its orders, so the dashboard shows the outcome within seconds.
  const results = (req) => {
    const id = req.headers['x-jerome-machine'];
    const machine = id ? db.prepare('SELECT id, public_key, status FROM machines WHERE id = ?').get(id) : null;
    if (!machine) throw new Refusal(401, 'unknown Mac: run `jerome connect` again');
    authentic(req, machine.public_key);
    if (machine.status !== 'approved') throw new Refusal(403, machine.status === 'pending' ? 'waiting for approval' : 'this Mac was revoked');
    const body = parse(req, SHAPES.results);
    record(id, body.results, new Date(now()).toISOString());
    return { status: 200, body: { ok: true } };
  };

  const routes = { 'POST /v1/hello': hello, 'POST /v1/beat': beat, 'POST /v1/results': results };
  const handle = (req) => {
    const route = routes[`${req.method} ${req.path}`];
    if (!route) return { status: 404, body: { error: 'not found' } };
    try {
      return route(req);
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      log(`refused ${req.path} from ${req.headers['x-jerome-machine'] ?? 'an unknown Mac'}: ${err.message}`);
      return { status: err.status, body: { error: err.message } };
    }
  };
  return { handle, db, config };
}

// `jerome director serve`: the HTTP server, on the one address of the setup.
export async function serve({ listen = null, env = process.env } = {}) {
  const wanted = listen ?? env.JEROME_DIRECTOR_LISTEN ?? readDirectorConfig(env)?.listen;
  if (!wanted) return fail('Give the address to listen on: `jerome director init --listen <VPN address>` first.');
  const where = parseListen(wanted);
  if (where.error) return fail(where.error);
  const refused = checkListen(where, env);
  if (refused) return fail(refused);
  const { config, created } = setup(wanted, env);
  const log = (line) => console.log(`${new Date().toISOString()} ${line}`);
  if (created) log(`set up in ${directorHome(env)}; Director fingerprint ${fingerprint(config.key.public)}`);
  const app = directorApp({ env, log });
  const server = createServer((req, res) => {
    // The dashboard (D151): its token is read at each request, so `dashboard --new-token` takes effect at once. Its one
    // write, an order for a Mac (D191), is a POST to /api/order with the same token.
    if (req.method === 'POST' && req.url === '/api/order') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= ORDER_BODY) chunks.push(c);
      });
      req.on('end', () => {
        try {
          const r = size > ORDER_BODY ? { status: 413, body: { error: 'too long' } }
            : takeOrder({ db: app.db, token: readDirectorConfig(env)?.dashboardToken, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
          res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          res.end(JSON.stringify(r.body));
          if (r.status === 201) log(`order ${r.body.id} from the dashboard: ${r.body.kind} for ${r.body.project}`);
        } catch (err) {
          log(`dashboard error: ${err.message}`);
          res.writeHead(500).end();
        }
      });
      return;
    }
    if (req.method === 'GET') {
      try {
        serveDashboard(req, res, { db: app.db, token: readDirectorConfig(env)?.dashboardToken });
      } catch (err) {
        log(`dashboard error: ${err.message}`);
        res.writeHead(500).end();
      }
      return;
    }
    const nonce = req.headers['x-jerome-nonce'] ?? '';
    const send = ({ status, body }) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', ...signResponse({ status, body: text, nonce, privatePem: config.key.private }) });
      res.end(text);
    };
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send({ status: 413, body: { error: 'body over 64 KB' } });
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      try {
        send(app.handle({ method: req.method, path: new URL(req.url, 'http://director').pathname, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }));
      } catch (err) {
        log(`error: ${err.message}`);
        send({ status: 500, body: { error: 'internal error' } });
      }
    });
  });
  await new Promise((done, failed) => {
    server.once('error', failed);
    server.listen(where.port, where.host, done);
  }).catch((err) => {
    throw new Error(`cannot listen on ${wanted}: ${err.message}`);
  });
  writeFileSync(pidFile(env), String(process.pid));
  log(`Jérôme Director ${VERSION} listening on ${where.host}:${server.address().port}${env.DIRECTOR_ADDRESS ? `, published on ${env.DIRECTOR_ADDRESS}` : ''}`);
  const stop = () => {
    rmSync(pidFile(env), { force: true });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return new Promise(() => {});
}

// `jerome director init`: the setup, or its address changed, and what Fabio needs to compare on each Mac.
export async function init({ listen = null, env = process.env } = {}) {
  const wanted = listen ?? env.JEROME_DIRECTOR_LISTEN ?? readDirectorConfig(env)?.listen;
  if (!wanted) return fail('Give the address to listen on: `jerome director init --listen <VPN address>`, the server\'s address on your VPN.');
  const where = parseListen(wanted);
  if (where.error) return fail(where.error);
  const refused = checkListen(where, env);
  if (refused) return fail(refused);
  const { config, created } = setup(wanted, env);
  const shown = shownAddress(config, env);
  console.log(`${created ? '✓ Director set up' : 'Director already set up'} in ${directorHome(env)}`);
  console.log(`  address      http://${shown}: on each Mac, \`jerome connect http://${shown}\``);
  console.log(`  fingerprint  ${fingerprint(config.key.public)}: each Mac shows it when it connects; it must be the same`);
  console.log(`  dashboard    http://${shown}/#${config.dashboardToken}: open it from any device on the VPN; keep it private`);
  return 0;
}

// The address the Macs and the browser use: the published one in a container.
function shownAddress(config, env) {
  const where = parseListen(config.listen);
  return env.DIRECTOR_ADDRESS && ['0.0.0.0', '::'].includes(where.host) ? `${env.DIRECTOR_ADDRESS}:${where.port}` : `${where.host}:${where.port}`;
}

// `jerome director dashboard [--new-token]`: the dashboard's address with its token; a new token makes every
// address given before stop working.
export async function dashboard({ newToken = false, env = process.env } = {}) {
  let config = readDirectorConfig(env);
  if (!config) return fail('The Director is not set up here: `jerome director init --listen <VPN address>`.');
  if (newToken || !config.dashboardToken) {
    config = { ...config, dashboardToken: randomBytes(18).toString('base64url') };
    writeDirectorConfig(config, env);
  }
  console.log(`${newToken ? '✓ New token: the address given before no longer opens the dashboard.\n' : ''}http://${shownAddress(config, env)}/#${config.dashboardToken}`);
  console.log('Open it from any device on the VPN, such as the iPhone. Keep it private: it shows everything the Director knows.');
  return 0;
}

const pad = (x) => String(x).padStart(2, '0');
const local = (iso) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function running(env) {
  try {
    const pid = Number(readFileSync(pidFile(env), 'utf8'));
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export async function status({ env = process.env } = {}) {
  const config = readDirectorConfig(env);
  if (!config) return fail('The Director is not set up here: `jerome director init --listen <VPN address>`.');
  const db = openDirectorDb(env);
  try {
    const pid = running(env);
    const count = (s) => db.prepare('SELECT count(*) n FROM machines WHERE status = ?').get(s).n;
    console.log(`director ${pid ? `running (pid ${pid})` : 'not running: `jerome director serve`'} on ${shownAddress(config, env)} · fingerprint ${fingerprint(config.key.public)}`);
    console.log(`macs     ${count('approved')} approved, ${count('pending')} waiting for approval${count('revoked') ? `, ${count('revoked')} revoked` : ''}`);
    const r = db.prepare('SELECT r.machine, r.read_at, r.data, m.name FROM readings r JOIN machines m ON m.id = r.machine ORDER BY r.read_at DESC LIMIT 1').get();
    if (r) {
      const w = JSON.parse(r.data).windows;
      console.log(`quota    ${['five_hour', 'seven_day'].filter((x) => w[x]).map((x) => `${x === 'five_hour' ? '5h' : '7d'} ${w[x].used}%`).join(' · ')}, read ${local(r.read_at)} by ${r.name}`);
    } else console.log('quota    no reading yet');
    return 0;
  } finally {
    db.close();
  }
}

export async function machines({ env = process.env } = {}) {
  const db = openDirectorDb(env);
  try {
    const rows = db.prepare('SELECT m.*, (SELECT count(*) FROM projects p WHERE p.machine = m.id) projects FROM machines m ORDER BY m.status, m.name').all();
    if (!rows.length) {
      console.log('No Mac yet: `jerome connect <address>` on each Mac.');
      return 0;
    }
    const table = [['MAC', 'CODE', 'STATUS', 'LAST BEAT', 'PROJECTS'], ...rows.map((m) => [m.name, m.id, m.status, local(m.last_beat), String(m.projects)])];
    const widths = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)));
    for (const r of table) console.log(r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  '));
    return 0;
  } finally {
    db.close();
  }
}

export async function approve(code, { env = process.env } = {}) {
  const db = openDirectorDb(env);
  try {
    const m = db.prepare('SELECT id, name, status FROM machines').all().find((x) => sameCode(x.id, code));
    if (!m) return fail(`No Mac has the code ${code}: \`jerome director machines\` lists them.`);
    if (m.status === 'revoked') return fail(`${m.name} was revoked: on it, \`jerome connect\` again makes a new key to approve.`);
    if (m.status === 'approved') {
      console.log(`${m.name} is already approved.`);
      return 0;
    }
    db.prepare("UPDATE machines SET status = 'approved', approved_at = ? WHERE id = ?").run(new Date().toISOString(), m.id);
    console.log(`✓ ${m.name} approved: its next beat, within a minute, is accepted.`);
    return 0;
  } finally {
    db.close();
  }
}

export async function revoke(which, { env = process.env } = {}) {
  const db = openDirectorDb(env);
  try {
    const m = db.prepare('SELECT id, name, status FROM machines').all().find((x) => x.name === which || sameCode(x.id, which));
    if (!m) return fail(`No Mac is called ${which}: \`jerome director machines\` lists them.`);
    db.prepare("UPDATE machines SET status = 'revoked', revoked_at = ? WHERE id = ?").run(new Date().toISOString(), m.id);
    db.prepare('DELETE FROM projects WHERE machine = ?').run(m.id);
    console.log(`✓ ${m.name} revoked: the Director refuses it from now on.`);
    return 0;
  } finally {
    db.close();
  }
}

function fail(message, code = 1) {
  console.error(message);
  return code;
}
