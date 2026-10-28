// Heartbeats that should have started and did not (D135): for each job installed, the last time its schedule
// fired, a few minutes back, and whether a heartbeat of that job started since. A run that was skipped still started
// and is recorded; a job that never ran its command (launchd not loading it, a PATH without node, the Mac off) left
// nothing. Read at zero tokens by `jerome projects` and by the watch job, which tells the user once per missed start.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { projectJobs, scheduler } from './schedule.js';
import { heartbeatConfig } from './heartbeatconfig.js';

// How late a start may be before it counts as missed: launchd starts a job at once, a run records itself in seconds.
export const MISSED_GRACE_MIN = 10;

// The last time at or before `before` that a job's calendar intervals fire (launchd's StartCalendarInterval: Hour,
// Minute, Weekday with 0 for Sunday), looking back a week, or null.
export function lastFire(intervals, before) {
  let best = null;
  for (let back = 0; back <= 7; back += 1) {
    const day = new Date(before.getFullYear(), before.getMonth(), before.getDate() - back);
    for (const i of intervals) {
      if (i.Weekday !== undefined && day.getDay() !== i.Weekday) continue;
      for (const hour of i.Hour === undefined ? [...Array(24).keys()] : [i.Hour]) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, i.Minute);
        if (at <= before && (!best || at > best)) best = at;
      }
    }
    if (best) return best;
  }
  return best;
}

// When this Mac last started, or null.
export function bootTime() {
  const r = spawnSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' });
  const m = r.status === 0 ? r.stdout.match(/sec = (\d+)/) : null;
  return m ? new Date(Number(m[1]) * 1000) : null;
}

// The project's missed starts, as [{ label, slot, at, why }]: `at` the time the job should have fired, `why` what is
// known about it (a job not loaded, the Mac started after that time).
export function missedStarts(dir, db, { now = new Date(), config = heartbeatConfig(dir).config, boot = bootTime() } = {}) {
  const s = scheduler();
  if (!s) return [];
  const installed = s.installed(dir);
  const missed = [];
  for (const job of projectJobs(dir, config).filter((j) => installed.includes(j.label))) {
    const at = lastFire(job.intervals, new Date(now.getTime() - MISSED_GRACE_MIN * 60_000));
    if (!at) continue;
    // A time before the job was written is not one it could have kept.
    let written;
    try {
      written = statSync(s.file(job.label)).mtimeMs;
    } catch {
      continue;
    }
    if (at.getTime() < written) continue;
    const since = new Date(at.getTime() - 60_000).toISOString();
    const started = db.prepare(`SELECT count(*) n FROM runs WHERE kind = 'heartbeat' AND started_at >= ?${job.slot ? ' AND slot = ?' : ''}`).get(...[since, ...(job.slot ? [job.slot] : [])]).n;
    if (started) continue;
    const why = !s.loaded(job.label) ? 'its job is not loaded in launchd: run `jerome heartbeat install`'
      : boot && boot > at ? `the Mac was off then (started ${boot.toISOString().slice(0, 16).replace('T', ' ')} UTC)`
        : 'launchd did not start it, or it failed before recording a run: see the log';
    missed.push({ label: job.label, slot: job.slot, at, why });
  }
  return missed;
}

// "evening of 2026-10-28 18:00", in local time.
export function missedText(m) {
  const pad = (x) => String(x).padStart(2, '0');
  const at = `${m.at.getFullYear()}-${pad(m.at.getMonth() + 1)}-${pad(m.at.getDate())} ${pad(m.at.getHours())}:${pad(m.at.getMinutes())}`;
  return `the heartbeat ${m.slot ? `of slot ${m.slot} ` : ''}due at ${at} did not start: ${m.why}`;
}
