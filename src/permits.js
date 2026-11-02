// Jérôme Director, step 3: the Director decides (docs/specs/director.md S4, D148, D201). From the freshest reading of
// any Mac and the projects each Mac said it has, it gives permits: fill runs across the Macs (D144, one per project,
// staggered), and slots that ask before they run and queue when there is no room. A permit only lets a Mac run work it
// already has, under its own checks; the Mac checks it again (D148). Nothing is decided until Fabio turns it on with
// `jerome director settings on` (D201): until then each Mac keeps phase 1.
import { pace, modelFor, GOVERNOR_DEFAULTS } from './pacing.js';

// A permit not started by then lapses; one started lapses at its maxMinutes plus this (D148), so a Mac switched off
// mid-run frees its place.
export const START_MS = 3 * 60_000;
const SLACK_MIN = 10;
// A queued slot not granted by then is dropped (D148).
export const QUEUE_MS = 6 * 3_600_000;
// A Mac beats every minute: one silent longer than this gets nothing new.
export const LIVE_MS = 5 * 60_000;
// As on one Mac (D142, D144): fill runs at least this far apart, and not in a project that started a heartbeat, or
// was given a fill run, this recently.
const STAGGER_MS = 5 * 60_000;
const COOLDOWN_MS = 30 * 60_000;

export function createPermitTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS permits (id INTEGER PRIMARY KEY, machine TEXT NOT NULL, project TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('fill', 'slot')), slot TEXT, model TEXT NOT NULL, max_minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('given', 'started', 'ended', 'lapsed')));
    CREATE INDEX IF NOT EXISTS permits_open ON permits (status);
    CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY, machine TEXT NOT NULL, project TEXT NOT NULL, slot TEXT NOT NULL,
      asked_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('waiting', 'granted', 'dropped')), permit INTEGER, done_at TEXT);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
}

// The Director's settings (S4): off until turned on, then the same target, reserve and 5-hour cap as phase 1.
export function directorSettings(db) {
  const kept = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, JSON.parse(r.value)]));
  return { on: kept.on === true, target: kept.target ?? GOVERNOR_DEFAULTS.target, reserve: kept.reserve ?? GOVERNOR_DEFAULTS.reserve, fiveHourCap: kept.fiveHourCap ?? GOVERNOR_DEFAULTS.fiveHourCap };
}

export function saveSettings(db, changes) {
  for (const [key, value] of Object.entries(changes)) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

// The pace from the freshest reading any Mac sent.
export function directorPace(db, now, settings = directorSettings(db)) {
  const r = db.prepare('SELECT read_at, data FROM readings ORDER BY read_at DESC LIMIT 1').get();
  const q = r ? JSON.parse(r.data) : null;
  return { pace: pace({ windows: q?.windows ?? {}, readAt: r ? new Date(r.read_at) : null, scoped: q?.scoped ?? [], settings, now: new Date(now) }), readAt: r?.read_at ?? null };
}

const iso = (ms) => new Date(ms).toISOString();

// The permits' and the queue's own clock: unstarted permits lapse after START_MS, started ones after their maxMinutes
// plus SLACK_MIN, waiting slots after QUEUE_MS.
function expire(db, at, log) {
  db.prepare("UPDATE permits SET status = 'lapsed', ended_at = ? WHERE status = 'given' AND created_at < ?").run(iso(at), iso(at - START_MS));
  for (const p of db.prepare("SELECT id, started_at, max_minutes FROM permits WHERE status = 'started'").all()) {
    if (Date.parse(p.started_at) + (p.max_minutes + SLACK_MIN) * 60_000 < at) db.prepare("UPDATE permits SET status = 'lapsed', ended_at = ? WHERE id = ?").run(iso(at), p.id);
  }
  for (const q of db.prepare("SELECT id, machine, project, slot FROM queue WHERE status = 'waiting' AND asked_at < ?").all(iso(at - QUEUE_MS))) {
    db.prepare("UPDATE queue SET status = 'dropped', done_at = ? WHERE id = ?").run(iso(at), q.id);
    log(`slot ${q.slot} of ${q.project} dropped: queued for 6 hours`);
  }
}

// What a Mac's beat says of the permits it was given: a project seen running started its permit, and one seen idle
// again ended it.
export function followPermits(db, machine, projects, at) {
  const running = new Map(projects.map((p) => [p.key, p.running]));
  for (const p of db.prepare("SELECT id, project, status FROM permits WHERE machine = ? AND status IN ('given', 'started')").all(machine)) {
    if (p.status === 'given' && running.get(p.project)) db.prepare("UPDATE permits SET status = 'started', started_at = ? WHERE id = ?").run(iso(at), p.id);
    if (p.status === 'started' && running.get(p.project) === false) db.prepare("UPDATE permits SET status = 'ended', ended_at = ? WHERE id = ?").run(iso(at), p.id);
  }
}

const busy = (db, machine, key) => Boolean(db.prepare("SELECT 1 FROM permits WHERE machine = ? AND project = ? AND status IN ('given', 'started')").get(machine, key));

// The projects of the Macs that beat lately, as they said them.
function liveProjects(db, at) {
  return db.prepare("SELECT p.machine, p.key, p.data FROM projects p JOIN machines m ON m.id = p.machine WHERE m.status = 'approved' AND m.last_beat >= ?")
    .all(iso(at - LIVE_MS)).map((p) => ({ machine: p.machine, key: p.key, ...JSON.parse(p.data) }));
}

// The model and length a project's runs have, as its Mac said them (D201), the model changed while its own weekly
// limit is ahead (spec D9).
function runShape(project, p) {
  const own = project.model ?? 'opus';
  return { model: modelFor(own, p.avoid)?.model ?? own, maxMinutes: project.maxMinutes };
}

function give(db, { machine, project, kind, slot = null, model, maxMinutes }, at, status = 'given') {
  return Number(db.prepare('INSERT INTO permits (machine, project, kind, slot, model, max_minutes, created_at, started_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(machine, project, kind, slot, model, maxMinutes, iso(at), status === 'started' ? iso(at) : null, status).lastInsertRowid);
}

// One decision, at each beat: queued slots first, then at most one fill run. Returns what it gave, for the log.
export function decide(db, { now = Date.now(), log = () => {} } = {}) {
  const settings = directorSettings(db);
  if (!settings.on) return [];
  expire(db, now, log);
  const { pace: p, readAt } = directorPace(db, now, settings);
  const given = [];
  const projects = liveProjects(db, now);
  const find = (machine, key) => projects.find((x) => x.machine === machine && x.key === key);
  // Slots run unless at the 5-hour cap or at the reserve (D142): a queued one goes as soon as its project is free.
  if (!['cap', 'reserve'].includes(p.kind)) {
    for (const q of db.prepare("SELECT * FROM queue WHERE status = 'waiting' ORDER BY asked_at").all()) {
      const project = find(q.machine, q.project);
      if (!project || project.running || busy(db, q.machine, q.project) || !project.slots.some((s) => s.name === q.slot) || !project.maxMinutes) continue;
      const id = give(db, { machine: q.machine, project: q.project, kind: 'slot', slot: q.slot, ...runShape(project, p) }, now);
      db.prepare("UPDATE queue SET status = 'granted', permit = ?, done_at = ? WHERE id = ?").run(id, iso(now), q.id);
      given.push({ id, kind: 'slot', project: project.name, slot: q.slot });
    }
  }
  // Fill runs (D144, across the Macs): on a go, STAGGER_MS after the last one, on a reading taken since.
  if (p.verdict !== 'go') return given;
  const last = db.prepare("SELECT max(created_at) at FROM permits WHERE kind = 'fill'").get().at;
  if (last && (now - Date.parse(last) < STAGGER_MS || !readAt || readAt <= last)) return given;
  const waiting = new Set(db.prepare("SELECT machine || '/' || project k FROM queue WHERE status = 'waiting'").all().map((r) => r.k));
  const since = iso(now - COOLDOWN_MS);
  const ready = projects.filter((x) => x.fill && !x.running && !x.overLimit && !x.alerts.length && x.maxMinutes
    && !(x.lastHeartbeat?.at >= since) && !waiting.has(`${x.machine}/${x.key}`) && !busy(db, x.machine, x.key)
    && !db.prepare("SELECT 1 FROM permits WHERE machine = ? AND project = ? AND kind = 'fill' AND created_at >= ?").get(x.machine, x.key, since))
    .sort((a, b) => String(a.lastHeartbeat?.at ?? '').localeCompare(String(b.lastHeartbeat?.at ?? '')));
  const pick = ready[0];
  if (!pick) return given;
  const id = give(db, { machine: pick.machine, project: pick.key, kind: 'fill', ...runShape(pick, p) }, now);
  given.push({ id, kind: 'fill', project: pick.name, why: p.why });
  return given;
}

// A permit as it travels (S3): exactly these fields, `slot` only for a slot.
const shape = (r) => ({ id: r.id, project: r.project, kind: r.kind, ...(r.kind === 'slot' ? { slot: r.slot } : {}), model: r.model, maxMinutes: r.max_minutes,
  expiresAt: iso(Date.parse(r.created_at) + START_MS) });

// The permits a Mac has not started yet, given again at each beat until it does or they lapse.
export function permitsFor(db, machine, now = Date.now()) {
  return db.prepare("SELECT * FROM permits WHERE machine = ? AND status = 'given' AND created_at >= ? ORDER BY id").all(machine, iso(now - START_MS)).map(shape);
}

// A slot's run asks before it starts (POST /v1/ask): a go with its permit, or queued, granted in a later beat.
export function askSlot(db, machine, { project: key, slot }, { now = Date.now(), log = () => {} } = {}) {
  const settings = directorSettings(db);
  if (!settings.on) return { go: true, mode: 'observing' };
  expire(db, now, log);
  const row = db.prepare('SELECT data FROM projects WHERE machine = ? AND key = ?').get(machine, key);
  const project = row ? JSON.parse(row.data) : null;
  // A project or a slot the Director has not heard of yet, as just after it was added: the Mac knows it, it runs.
  if (!project?.slots.some((s) => s.name === slot) || !project.maxMinutes) return { go: true, mode: 'directing', why: 'not known here yet' };
  const { pace: p } = directorPace(db, now, settings);
  const why = ['cap', 'reserve'].includes(p.kind) ? p.why : busy(db, machine, key) ? 'another run has this project' : null;
  if (why) {
    if (!db.prepare("SELECT 1 FROM queue WHERE machine = ? AND project = ? AND slot = ? AND status = 'waiting'").get(machine, key, slot)) {
      db.prepare("INSERT INTO queue (machine, project, slot, asked_at, status) VALUES (?, ?, ?, ?, 'waiting')").run(machine, key, slot, iso(now));
      log(`slot ${slot} of ${project.name} queued: ${why}`);
    }
    return { go: false, queued: true, mode: 'directing', why };
  }
  const id = give(db, { machine, project: key, kind: 'slot', slot, ...runShape(project, p) }, now, 'started');
  return { go: true, mode: 'directing', permit: id };
}

// What the dashboard and `jerome director status` show of the decisions: the open permits and the queued slots.
export function decisions(db, now = Date.now()) {
  return {
    permits: db.prepare("SELECT * FROM permits WHERE status IN ('given', 'started') ORDER BY id").all().map((r) => ({
      ...shape(r), machine: r.machine, status: r.status, startedAt: r.started_at,
      until: r.status === 'started' ? iso(Date.parse(r.started_at) + (r.max_minutes + SLACK_MIN) * 60_000) : iso(Date.parse(r.created_at) + START_MS),
    })),
    queued: db.prepare("SELECT machine, project, slot, asked_at FROM queue WHERE status = 'waiting' ORDER BY asked_at").all()
      .map((q) => ({ machine: q.machine, project: q.project, slot: q.slot, askedAt: q.asked_at, dropsAt: iso(Date.parse(q.asked_at) + QUEUE_MS) })),
    recent: db.prepare("SELECT * FROM permits WHERE created_at >= ? ORDER BY id DESC LIMIT 100").all(iso(now - 7 * 86_400_000))
      .map((r) => ({ id: r.id, machine: r.machine, project: r.project, kind: r.kind, slot: r.slot, model: r.model, status: r.status, createdAt: r.created_at, endedAt: r.ended_at })),
  };
}
