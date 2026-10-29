// `jerome heartbeat install | uninstall | status | run <slot> | marathon --until HH:MM | override --today` (D118).
// The run itself is heartbeat.js; this file installs a project's jobs from its slots, shows how its autonomous runs
// are going, and runs them back to back until a given time (D123).
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { MARKER } from './template.js';
import { notProjectMessage } from './paths.js';
import { openDb } from './db.js';
import { heartbeatConfig, describeSlot, runAllowed } from './heartbeatconfig.js';
import { projectJobs, scheduler, jobPaths, describe, logPath, jobLabel } from './schedule.js';
import { lockHolder, readResume, overrideToday, setOverride, localDay } from './runstate.js';
import { openAlerts, lostRuns } from './alerts.js';
import { heartbeat } from './heartbeat.js';

function project(dirArg) {
  const dir = resolve(dirArg);
  return { dir, error: existsSync(join(dir, MARKER)) ? null : notProjectMessage(dir) };
}

// Writes and loads the project's jobs, one per slot, and removes the jobs it has that its settings no longer list.
// Running it again changes nothing.
export async function install(dirArg) {
  const { dir, error } = project(dirArg);
  if (error) return fail(error, 1);
  const s = scheduler();
  if (!s) return fail('Heartbeats are scheduled with launchd, so only on macOS for now.', 1);
  const { config, problems } = heartbeatConfig(dir);
  if (problems.length) return fail(`Fix the heartbeat settings first:\n${problems.map((p) => `  ${p}`).join('\n')}`, 2);
  const jobs = projectJobs(dir, config);
  if (!jobs.length) return fail('This project has no slots: add "slots" under "heartbeat" in .jerome/project.json (see docs/heartbeat.md), or schedule one run with `jerome schedule`.', 2);
  const paths = jobPaths();
  if (!paths.claude) return fail('`claude` was not found on the PATH: install Claude Code first.', 1);
  for (const job of jobs) {
    const failed = s.write(dir, job, paths);
    if (failed) return fail(`${s.name} could not load the job ${job.label}: ${failed}`, 1);
  }
  const removed = s.installed(dir).filter((l) => !jobs.some((j) => j.label === l));
  for (const label of removed) s.remove(label);
  for (const job of jobs) {
    const slot = config.slots.find((x) => x.name === job.slot);
    console.log(`✓ ${slot ? `slot ${slot.name}: ${describeSlot(slot)}` : describe(config.legacy)} (${job.label})`);
    // What its runs may do beyond the project's allow rules (D129): anything else they are refused, with an alert.
    const allowed = runAllowed(config, slot);
    if (allowed.length) console.log(`  allowed: ${allowed.join(', ')}`);
  }
  for (const label of removed) console.log(`✓ removed ${label}, no longer in the settings`);
  console.log(`  ${config.mainBranch} ← ${config.workBranch} · at most ${config.maxMinutes} min per run · log ${logPath(jobLabel(dir))}`);
  return 0;
}

// Removes every job of the project and leaves its settings, so `install` puts them back.
export async function uninstall(dirArg) {
  const { dir, error } = project(dirArg);
  if (error) return fail(error, 1);
  const s = scheduler();
  if (!s) return fail('Heartbeats are scheduled with launchd, so only on macOS for now.', 1);
  const labels = s.installed(dir);
  for (const label of labels) s.remove(label);
  console.log(labels.length ? `✓ Removed ${labels.length} ${labels.length === 1 ? 'job' : 'jobs'}: ${labels.join(', ')}` : 'No heartbeat jobs were installed for this project.');
  return 0;
}

// Lifts the limits on this project's runs until local midnight (D124).
export async function override(dirArg, { today = false, now = new Date() } = {}) {
  const { dir, error } = project(dirArg);
  if (error) return fail(error, 1);
  if (!today) return fail('jerome heartbeat override takes --today: the limits are lifted for this project until midnight.', 2);
  setOverride(dir, now);
  console.log(`✓ Limits lifted for ${basename(dir)}'s heartbeats until the end of ${localDay(now)}.`);
  return 0;
}

// How the project's autonomous runs are going, at zero tokens: jobs, the run going on, the open alerts, whether the
// next run resumes, and the latest runs with their mode, length and end check.
export async function status(dirArg, { runs = 8, now = new Date() } = {}) {
  const { dir, error } = project(dirArg);
  if (error) return fail(error, 1);
  const { config, problems } = heartbeatConfig(dir);
  const s = scheduler();
  const jobs = projectJobs(dir, config);
  const lines = [`${basename(dir)} · heartbeats`];
  const installed = s ? s.installed(dir) : [];
  const job = (j) => `${j.slot ? `${j.slot} ${describeSlot(config.slots.find((x) => x.name === j.slot))}` : describe(config.legacy)} ${!installed.includes(j.label) ? '(not installed)' : s.loaded(j.label) ? '(loaded)' : '(not loaded)'}`;
  lines.push(`jobs     ${jobs.length ? jobs.map(job).join(' · ') : 'none: no slots and no schedule'}`);
  for (const p of problems) lines.push(`         ! ${p}`);
  const pid = lockHolder(dir);
  lines.push(`now      ${pid ? `a heartbeat is running (pid ${pid}): leave git to it, or work in a separate worktree` : 'no heartbeat running'}`);
  const resume = readResume(dir);
  if (resume) lines.push(`resume   the next run resumes: ${resume.reason}`);
  if (overrideToday(dir, now)) lines.push(`limits   lifted for today (jerome heartbeat override --today)`);
  const db = openDb(dir);
  if (!db) return fail('The project database is missing: run `jerome doctor` to create it.', 1);
  try {
    const alerts = openAlerts(db);
    const lost = alerts.reduce((t, a) => t + a.count, 0);
    lines.push(`alerts   ${alerts.length ? `${alerts.length} open, ${lost} ${lost === 1 ? 'run' : 'runs'} lost: tell the user` : 'none open'}`);
    for (const a of alerts) lines.push(`  A${a.id} ${a.reason} · ${lostRuns(a)}`);
    const recent = db.prepare("SELECT id, started_at, ended_at, status, reason, mode, slot, exit_code, outcome FROM runs WHERE kind = 'heartbeat' ORDER BY id DESC LIMIT ?").all(runs);
    lines.push(`runs     ${recent.length ? `last ${recent.length}` : 'none yet'}`);
    for (const r of recent) {
      const outcome = r.outcome ? JSON.parse(r.outcome) : null;
      const length = r.ended_at ? `${Math.max(0, Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60_000))} min` : 'running';
      const flags = [r.mode, r.slot, length, r.exit_code !== null ? `exit ${r.exit_code}` : null, outcome ? `end check ${outcome.ok ? 'ok' : 'failed'}` : null].filter(Boolean).join(', ');
      lines.push(`  ${when(r.started_at)} ${r.status} [${flags}] ${r.reason ?? ''}`.trimEnd());
    }
  } finally {
    db.close();
  }
  lines.push(`log      ${logPath(jobLabel(dir))}`);
  console.log(lines.join('\n'));
  return 0;
}

const when = (iso) => {
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, '0');
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// The end of a marathon (D123): the given time on the calendar day it started, 24:00 being the midnight that ends
// it. A full date, never an hour alone, so a marathon never runs into the next day.
export function marathonDeadline(until, start) {
  const m = String(until ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[2]) > 59 || Number(m[1]) > 24 || (Number(m[1]) === 24 && Number(m[2]) !== 0)) return null;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), Number(m[1]), Number(m[2]));
}

export const MARATHON = { pauseMs: 2 * 60_000, backoffMs: 30 * 60_000, lockPollMs: 60_000 };

// Heartbeats back to back until the deadline: a short pause after a run where the lead agent worked, a long one
// after a skip, a failure or no work, and a wait while another heartbeat holds the lock. A run never starts at or
// after the deadline. The clock, the wait and the run are given by the tests.
export async function marathon(dirArg, { until, now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), runOnce = null, env = process.env, timing = MARATHON, log = console.log } = {}) {
  const { dir, error } = project(dirArg);
  if (error) return fail(error, 1);
  const start = now();
  const deadline = marathonDeadline(until, start);
  if (!deadline) return fail('--until takes a time of today, such as 23:30, or 24:00 for midnight.', 2);
  if (deadline <= start) return fail(`It is already past ${until} today: a marathon never runs into the next day.`, 2);
  const once = runOnce ?? (async () => {
    await heartbeat(dir, { env, now: now() });
    return lastRun(dir);
  });
  const left = () => deadline.getTime() - now().getTime();
  log(`marathon until ${localDay(deadline)} ${until === '24:00' ? '24:00' : until}`);
  let count = 0;
  while (left() > 0) {
    if (lockHolder(dir)) {
      await sleep(Math.min(timing.lockPollMs, left()));
      continue;
    }
    const run = await once();
    count += 1;
    const pause = run?.worked ? timing.pauseMs : timing.backoffMs;
    log(`marathon run ${count}: ${run?.status ?? 'unknown'}${run?.reason ? ` (${run.reason})` : ''}; next in ${Math.round(Math.min(pause, Math.max(0, left())) / 60_000)} min`);
    if (left() <= 0) break;
    await sleep(Math.min(pause, left()));
  }
  log(`marathon over: ${count} ${count === 1 ? 'run' : 'runs'}`);
  return 0;
}

// The latest heartbeat of the project, and whether its lead agent ran and ended well.
function lastRun(dir) {
  const db = openDb(dir);
  try {
    const r = db.prepare("SELECT status, reason, exit_code FROM runs WHERE kind = 'heartbeat' ORDER BY id DESC LIMIT 1").get();
    return r ? { status: r.status, reason: r.reason, worked: r.status === 'done' && r.exit_code !== null } : null;
  } finally {
    db.close();
  }
}

function fail(message, code) {
  console.error(message);
  return code;
}

// `jerome heartbeat wait [dir]` (D187): until the heartbeat running in the project ends, for a session that fixed
// something in a worktree meanwhile and merges it once the working tree is free. It holds nothing and changes nothing.
export async function wait(dirArg, { pollMs = Number(process.env.JEROME_WAIT_POLL_MS) || 5000, maxMs = 120 * 60_000 } = {}) {
  const dir = resolve(dirArg);
  const end = Date.now() + maxMs;
  const pid = lockHolder(dir);
  if (!pid) {
    console.log('No heartbeat is running here: the working tree is free.');
    return 0;
  }
  console.log(`Waiting for the heartbeat running here (pid ${pid}) to end…`);
  while (lockHolder(dir)) {
    if (Date.now() > end) {
      console.error(`The heartbeat is still running after ${Math.round(maxMs / 60_000)} min: \`jerome heartbeat status\` shows it.`);
      return 1;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  console.log('The heartbeat has ended: the working tree is free. Merge what waits, then go on.');
  return 0;
}
