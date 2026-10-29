// The quota governor, phase 1 (D141-D144): on one Mac, the watchdog reads the real quota every few minutes and, while
// the week is behind its pace, starts fill runs in the projects given to the governor, one per project at most and
// staggered. Off by default, and machine-wide: its settings and projects live in account.json, not in a project.
// `jerome governor on|off|add|remove|status` and `jerome quota`.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { readAccount, writeAccount } from './account.js';
import { refreshQuota, readingTime } from './quota.js';
import { pace, GOVERNOR_DEFAULTS } from './pacing.js';
import { MARKER } from './template.js';
import { openDb, dbPath } from './db.js';
import { lockHolder, cacheDir } from './runstate.js';
import { jobLabel, logPath } from './schedule.js';
import { heartbeatConfig, slotWithin } from './heartbeatconfig.js';
import { projectStatus, projectOver, projectLimitSettings, limitText } from './budget.js';
import { activeSession } from './activity.js';

const BIN = join(import.meta.dirname, '..', 'bin', 'jerome.js');
// A project whose last heartbeat started this recently is left alone: it has just looked for work.
export const FILL_COOLDOWN_MIN = 30;
// The least time between two fill runs started on the machine, the time of a fresh reading of the quota.
export const STAGGER_MIN = 5;
const lastVerdictPath = () => cacheDir('governor', 'last.json');

export function governorSettings(account = readAccount()) {
  const g = account.governor ?? {};
  return { on: g.on === true, target: g.target ?? GOVERNOR_DEFAULTS.target, reserve: g.reserve ?? GOVERNOR_DEFAULTS.reserve, fiveHourCap: g.fiveHourCap ?? GOVERNOR_DEFAULTS.fiveHourCap, projects: g.projects ?? [] };
}

// The pacing verdict from what account.json holds now.
export function currentPace(account = readAccount(), now = new Date()) {
  return pace({ windows: account.windows, readAt: readingTime(account), scoped: account.quota?.scoped ?? [], settings: governorSettings(account), now });
}

// One pass of the watchdog (D142). Returns the verdict, or null with the governor off.
export async function governorTick({ env = process.env, now = new Date(), log = () => {} } = {}) {
  if (!governorSettings().on) return null;
  const before = readAccount().quota?.error ?? null;
  const account = await refreshQuota({ env, now });
  const error = account.quota?.error ?? null;
  if (error && error !== before) log(`governor: quota not read: ${error}`);
  const p = currentPace(account, now);
  const g = governorSettings(account);
  // The verdict goes to the log when it changes, not every minute.
  let last = {};
  try {
    last = JSON.parse(readFileSync(lastVerdictPath(), 'utf8'));
  } catch {
    // None yet.
  }
  const save = (next) => {
    last = { ...last, ...next };
    mkdirSync(dirname(lastVerdictPath()), { recursive: true });
    writeFileSync(lastVerdictPath(), JSON.stringify(last));
  };
  if (last.kind !== p.kind) {
    log(`governor: ${p.verdict}, ${p.why}`);
    save({ kind: p.kind, at: now.toISOString() });
  }
  if (p.verdict !== 'go') return p;
  // Runs go in parallel, one per project at most (its lock), but they start staggered (D144): a new one only
  // STAGGER_MIN minutes after the last, and on a reading taken since, so the pace sees what the runs already
  // started are taking before it adds one.
  const started = last.startedAt ? Date.parse(last.startedAt) : 0;
  if (now.getTime() - started < STAGGER_MIN * 60_000) return p;
  if (started && (readingTime(account)?.getTime() ?? 0) <= started) return p;
  const dir = pickProject(g.projects, now);
  if (!dir) return p;
  log(`governor: fill run in ${basename(dir)}: ${p.why}`);
  save({ startedAt: now.toISOString() });
  launchFill(dir, env);
  return { ...p, started: dir };
}

// The project to fill: among the governor's, those with no open alert, no heartbeat started in the last
// FILL_COOLDOWN_MIN minutes and no slot due before a run started now would end (D176), the one whose last heartbeat
// is oldest.
export function pickProject(projects, now = new Date()) {
  const since = new Date(now.getTime() - FILL_COOLDOWN_MIN * 60_000).toISOString();
  const ready = [];
  for (const dir of projects) {
    if (!existsSync(join(dir, MARKER)) || !existsSync(dbPath(dir)) || lockHolder(dir)) continue;
    const { slots, maxMinutes } = heartbeatConfig(dir).config;
    if (slotWithin(slots, maxMinutes, now)) continue;
    // A project the user is working in, in a session, is left to them (D187): the fill run goes elsewhere.
    if (activeSession(dir, { now })) continue;
    const db = openDb(dir, { readOnly: true, migrate: false });
    if (!db) continue;
    try {
      if (db.prepare("SELECT count(*) n FROM alerts WHERE status = 'open'").get().n) continue;
      // A project at its own daily or weekly limit would only be paused.
      if (projectOver(projectStatus(dir, db, now))) continue;
      const last = db.prepare("SELECT max(started_at) at FROM runs WHERE kind = 'heartbeat'").get().at;
      if (last && last >= since) continue;
      ready.push({ dir, last: last ?? '' });
    } catch {
      // A database from before the alerts is not filled: doctor migrates it at the next heartbeat.
    } finally {
      db.close();
    }
  }
  ready.sort((a, b) => a.last.localeCompare(b.last));
  return ready[0]?.dir ?? null;
}

// `jerome heartbeat fill <dir>`, apart from the watchdog, its output in the project's log. JEROME_FILL_SYNC waits
// for it, for the tests.
function launchFill(dir, env) {
  const args = [BIN, 'heartbeat', 'fill', dir];
  if (env.JEROME_FILL_SYNC) {
    spawnSync(process.execPath, args, { env, stdio: 'ignore' });
    return;
  }
  const file = logPath(jobLabel(dir));
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  spawn(process.execPath, args, { env, detached: true, stdio: ['ignore', fd, fd] }).unref();
  closeSync(fd);
}

// What a run of the lead agent took from the windows (D143), over the governor's projects and the last 7 days: the
// average points of the 7-day window per run, by model.
export function runCosts(projects, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const by = {};
  for (const dir of projects) {
    if (!existsSync(dbPath(dir))) continue;
    const db = openDb(dir, { readOnly: true, migrate: false });
    if (!db) continue;
    try {
      for (const r of db.prepare('SELECT quota FROM runs WHERE quota IS NOT NULL AND started_at >= ?').all(since)) {
        const q = JSON.parse(r.quota);
        const d = q.after?.seven_day - q.before?.seven_day;
        // A window that reset during the run says nothing.
        if (!Number.isFinite(d) || d < 0) continue;
        (by[q.model] ??= []).push(d);
      }
    } catch {
      // A database from before schema 9 has no costs yet.
    } finally {
      db.close();
    }
  }
  return Object.fromEntries(Object.entries(by).map(([model, ds]) => [model, { runs: ds.length, points: Math.round((ds.reduce((a, b) => a + b, 0) / ds.length) * 10) / 10 }]));
}

const pad = (x) => String(x).padStart(2, '0');
const local = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// The quota as read, the pace, and the verdict: `jerome quota`, and the top of `jerome governor status`.
export function quotaLines(account, now = new Date()) {
  const lines = [];
  const w = account.windows ?? {};
  const at = readingTime(account);
  const window = (name, label) => {
    const x = w[name];
    if (!x) return `${label} no reading`;
    if (x.resetsAt && x.resetsAt * 1000 <= now.getTime()) return `${label} no reading since its reset`;
    return `${label} ${x.used}%${x.resetsAt ? ` (resets ${local(x.resetsAt * 1000)})` : ''}`;
  };
  const source = account.quota?.readAt && at && Date.parse(account.quota.readAt) === at.getTime() ? 'the usage endpoint' : 'the status line and the runs';
  lines.push(`quota    ${window('five_hour', '5h')} · ${window('seven_day', '7d')}${at ? ` · read ${Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000))} min ago from ${source}` : ''}`);
  const extra = [
    ...(account.quota?.scoped ?? []).map((s) => `${s.model} ${s.used}% of its weekly limit`),
    account.quota?.breakdown?.length ? `this week ${account.quota.breakdown.filter((b) => b.percent).map((b) => `${b.name} ${b.percent}%`).join(', ')}` : null,
  ].filter(Boolean);
  if (extra.length) lines.push(`         ${extra.join(' · ')}`);
  if (account.quota?.error) lines.push(`         last attempt ${local(Date.parse(account.quota.attemptAt))}: ${account.quota.error}`);
  const p = currentPace(account, now);
  lines.push(p.target === null ? `pace     ${p.verdict}: ${p.why}` : `pace     target now ${p.target}% · ceiling ${p.ceiling}% · ${p.verdict}: ${p.why}${p.avoid.length ? ` · avoiding ${p.avoid.join(', ')}` : ''}`);
  return lines;
}

export async function quota({ json = false, env = process.env, now = new Date() } = {}) {
  const account = await refreshQuota({ env, now, force: true });
  if (json) {
    console.log(JSON.stringify({ schema: 'jerome.quota/v1', at: now.toISOString(), windows: account.windows, quota: account.quota ?? null, pace: currentPace(account, now), governor: governorSettings(account) }, null, 2));
    return 0;
  }
  console.log(quotaLines(account, now).join('\n'));
  return account.quota?.error ? 1 : 0;
}

export async function governorStatus({ env = process.env, now = new Date() } = {}) {
  const account = await refreshQuota({ env, now });
  const g = governorSettings(account);
  console.log(`governor ${g.on ? 'on' : 'off: `jerome governor on`'} · target ${g.target}% · reserve ${g.reserve}% · 5h cap ${g.fiveHourCap}% · one governor per account: keep it on one Mac only`);
  console.log(quotaLines(account, now).join('\n'));
  console.log(`projects ${g.projects.length ? g.projects.map((d) => `${basename(d)}${existsSync(join(d, MARKER)) ? '' : ' (gone)'}`).join(', ') : 'none: `jerome governor add [dir]` in each project to fill'}`);
  const costs = Object.entries(runCosts(g.projects, now));
  if (costs.length) console.log(`cost     per run, 7 days: ${costs.map(([m, c]) => `${m} ${c.points} pt of 7d (${c.runs} ${c.runs === 1 ? 'run' : 'runs'})`).join(' · ')}`);
  return 0;
}

const PERCENT = (v, name, min = 1) => {
  const x = Number(v);
  if (!Number.isFinite(x) || x < min || x > 100) throw new Error(`--${name} takes a percentage from ${min} to 100.`);
  return x;
};

export async function governor(action, dirArg, { target, reserve, fiveHourCap } = {}) {
  const account = readAccount();
  const g = governorSettings(account);
  const save = (next) => {
    account.governor = { ...account.governor, ...next };
    writeAccount(account);
  };
  try {
    if (action === 'on') {
      save({ on: true, ...(target !== undefined ? { target: PERCENT(target, 'target') } : {}), ...(reserve !== undefined ? { reserve: PERCENT(reserve, 'reserve', 0) } : {}), ...(fiveHourCap !== undefined ? { fiveHourCap: PERCENT(fiveHourCap, 'five-hour-cap') } : {}) });
      const now = governorSettings(account);
      console.log(`✓ Governor on: 7d to ${now.target}% by its reset, ${now.reserve}% kept for you, 5h up to ${now.fiveHourCap}%. Keep it on one Mac only.`);
      if (!now.projects.length) console.log('  No project to fill yet: `jerome governor add` in each project.');
      return 0;
    }
    if (action === 'off') {
      save({ on: false });
      console.log('✓ Governor off: heartbeats run on their slots only, within the fixed limits.');
      return 0;
    }
    const dir = resolve(dirArg ?? '.');
    if (action === 'add') {
      if (!existsSync(join(dir, MARKER))) throw new Error(`${dir} is not a Jérôme project.`);
      if (!g.projects.includes(dir)) save({ projects: [...g.projects, dir] });
      console.log(`✓ ${basename(dir)} gets fill runs when the week is behind its pace${g.on ? '' : ' (the governor is off: `jerome governor on`)'}.`);
      const { limits } = projectLimitSettings(dir);
      const set = ['daily', 'weekly'].filter((k) => limits[k]).map((k) => `${k} ${limitText(limits[k])}`);
      if (set.length) console.log(`  Its own limits still apply (${set.join(', ')} API-equivalent): \`jerome limits --daily … --weekly …\` gives it more room, \`off\` none.`);
      return 0;
    }
    if (action === 'remove') {
      save({ projects: g.projects.filter((d) => d !== dir) });
      console.log(`✓ ${basename(dir)} gets no more fill runs.`);
      return 0;
    }
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  return 2;
}
