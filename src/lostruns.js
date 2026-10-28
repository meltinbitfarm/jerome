// Runs left "running" by a process that is gone (D136): a heartbeat whose runner died, or ran far past its max
// duration, and an interactive session that ended without its SessionEnd hook. They are closed with a reason that
// says so, their usage read from the transcript, and a heartbeat's lead agent, which runs in a process group of its
// own (D120), stopped if it outlived its runner. Run by the heartbeat once it holds the lock, by SessionStart and by
// the bridge's job (D134), at zero tokens.
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { openDb } from './db.js';
import { alive, lockHolder, currentBranch, uncommitted, operationInProgress, writeResume } from './runstate.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { closeSession } from './hooks.js';
import { findTranscript } from './delegations.js';
import { raiseAlert } from './alerts.js';

// A heartbeat still running this long after its max duration has stopped answering: the runner stops the lead agent
// at maxMinutes, so only a hung runner gets here.
export const LOST_MARGIN_MIN = 15;
// An interactive session with no pid recorded (from before D136, or Claude Code not found among the hook's parents)
// counts as gone this long after it started, as D122 assumed.
export const INTERACTIVE_HOURS = 12;

// When a process started, as ps prints it, or null when there is no such process.
export function processStart(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() || null : null;
}

// Whether the process recorded is still the one running under that pid.
export function sameProcess(pid, started) {
  if (!alive(pid)) return false;
  return !started || processStart(pid) === started;
}

// The Claude Code process a hook runs under: the first parent, a few levels up, whose command is claude.
export function claudePid(from = process.ppid) {
  let pid = from;
  for (let i = 0; i < 6 && pid > 1; i += 1) {
    const r = spawnSync('ps', ['-o', 'ppid=,comm=,args=', '-p', String(pid)], { encoding: 'utf8' });
    const m = r.status === 0 ? r.stdout.trim().match(/^(\d+)\s+(\S+)\s*(.*)$/) : null;
    if (!m) return null;
    if (basename(m[2]) === 'claude' || /(^|\/)claude(\s|$)/.test(m[3])) return pid;
    pid = Number(m[1]);
  }
  return null;
}

// Closes the project's lost runs. `ownRun` is the heartbeat calling, which holds the lock: any other heartbeat still
// marked running is then lost. Returns the runs closed, as { id, kind, reason, alert }.
export function sweepLostRuns(dir, { ownRun = null, now = new Date() } = {}) {
  const db = openDb(dir);
  if (!db) return [];
  let rows;
  try {
    rows = db.prepare("SELECT id, session_id, kind, started_at, pid, pid_started, lead_pid, lead_started FROM runs WHERE status = 'running' AND kind IN ('heartbeat', 'interactive') AND id IS NOT ?").all(ownRun);
  } finally {
    db.close();
  }
  if (!rows.length) return [];
  const { config } = heartbeatConfig(dir);
  const holder = ownRun ? null : lockHolder(dir);
  const closed = [];
  for (const r of rows) {
    const age = now.getTime() - Date.parse(r.started_at);
    let reason = null;
    if (r.kind === 'heartbeat') {
      const runner = r.pid ? sameProcess(r.pid, r.pid_started) : holder !== null;
      if (ownRun || !runner || (r.pid && holder !== null && holder !== r.pid)) reason = 'lost: the runner died';
      else if (age > (config.maxMinutes + LOST_MARGIN_MIN) * 60_000) {
        reason = `lost: still running ${config.maxMinutes + LOST_MARGIN_MIN} min after it started, over its max duration; runner stopped`;
        // A runner that hangs is stopped; its lock then goes as a stale one.
        if (r.pid) kill(r.pid);
      }
      if (!reason) continue;
      // Its lead agent, in a process group of its own, is stopped with the whole group if it outlived the runner.
      if (r.lead_pid && sameProcess(r.lead_pid, r.lead_started)) {
        kill(-r.lead_pid);
        reason += ', its lead agent stopped';
      }
    } else {
      const gone = r.pid ? !sameProcess(r.pid, r.pid_started) : age > INTERACTIVE_HOURS * 3_600_000;
      if (!gone) continue;
      reason = 'lost: the session ended without SessionEnd';
    }
    // The usage the session left in its transcripts is read, as SessionEnd would have, before the run is closed.
    closeSession(dir, { session_id: r.session_id, transcript_path: findTranscript(r.session_id), reason: 'lost' });
    const db2 = openDb(dir);
    let alert = null;
    try {
      db2.prepare('UPDATE runs SET status = ?, reason = ?, ended_at = coalesce(ended_at, ?) WHERE id = ?')
        .run(r.kind === 'heartbeat' ? 'failed' : 'stopped', reason, now.toISOString(), r.id);
      if (r.kind === 'heartbeat') {
        alert = raiseAlert(db2, { reason: `heartbeat of ${r.started_at.slice(0, 16).replace('T', ' ')} UTC ${reason}`, key: 'lost', runId: r.id, now });
      }
    } finally {
      db2.close();
    }
    // Work it left in the tree is resumed by the next run, as after a failed end check (D119).
    if (r.kind === 'heartbeat' && (currentBranch(dir) !== config.mainBranch || (uncommitted(dir) ?? []).length || operationInProgress(dir))) {
      writeResume(dir, { since: now.toISOString(), runId: r.id, reason, branch: currentBranch(dir) });
    }
    closed.push({ id: r.id, kind: r.kind, reason, alert });
  }
  return closed;
}

function kill(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}
