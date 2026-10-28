// Alerts (D121): something wrong with the autonomous runs themselves, which the user must hear about first. Kept in
// the project database like the decision requests, never in a tracked file: the runner checks for a clean tree.
// An alert is raised at once for a broken end state or a start state that is not a heartbeat's, and for any other
// skip or failure when the run before it stopped for the same reason. It closes when a heartbeat ends well.
import { spawnSync } from 'node:child_process';

// What makes two reasons "the same": the words before the first colon or parenthesis, numbers aside, so
// "global limit: 7d 72% ≥ 70%" and "global limit: 7d 74% ≥ 70%" count as one.
export function alertKey(reason) {
  return String(reason ?? '').split(/[:(]/)[0].replace(/\d+/g, '#').trim().slice(0, 80) || 'unknown';
}

// Opens an alert, or counts one more on the open alert with the same key. Returns { id, isNew, count, openedAt }.
// An alert opened on a repeat starts at the number of times it has happened.
export function raiseAlert(db, { reason, key = alertKey(reason), runId = null, count = 1, now = new Date() }) {
  const at = now.toISOString();
  const open = db.prepare("SELECT id, count, opened_at FROM alerts WHERE status = 'open' AND key = ?").get(key);
  if (open) {
    db.prepare('UPDATE alerts SET count = count + 1, last_at = ?, reason = ?, run_id = coalesce(?, run_id) WHERE id = ?').run(at, reason, runId, open.id);
    return { id: open.id, isNew: false, count: open.count + 1, openedAt: open.opened_at };
  }
  const id = Number(db.prepare('INSERT INTO alerts (run_id, key, reason, opened_at, last_at, count) VALUES (?, ?, ?, ?, ?, ?)').run(runId, key, reason, at, at, count).lastInsertRowid);
  return { id, isNew: true, count, openedAt: at };
}

export function resolveAlerts(db, now = new Date()) {
  return db.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE status = 'open'").run(now.toISOString()).changes;
}

export function openAlerts(db) {
  return db.prepare("SELECT id, run_id, key, reason, opened_at, last_at, count FROM alerts WHERE status = 'open' ORDER BY opened_at").all()
    .map((a) => ({ id: a.id, runId: a.run_id, key: a.key, reason: a.reason, openedAt: a.opened_at, lastAt: a.last_at, count: a.count }));
}

// Whether the heartbeat before this one ended blocked, stopped or failed for the same reason: two in a row is an alert.
export function sameAsBefore(db, runId, reason) {
  const before = db.prepare("SELECT status, reason FROM runs WHERE kind = 'heartbeat' AND id < ? AND status != 'running' ORDER BY id DESC LIMIT 1").get(runId);
  return Boolean(before) && ['blocked', 'stopped', 'failed'].includes(before.status) && alertKey(before.reason) === alertKey(reason);
}

// The push channel (D121), off by default: the project's command, run with the alert on standard input and in
// JEROME_ALERT_*. Its output is never logged, since it may echo a secret it reads; only a failure is returned.
export function pushAlert(command, { project, dir, message, env = process.env }) {
  if (!command) return null;
  const r = spawnSync('/bin/sh', ['-c', command], {
    cwd: dir, input: `${message}\n`, stdio: ['pipe', 'ignore', 'ignore'], timeout: 20_000,
    env: { ...env, JEROME_ALERT_PROJECT: project, JEROME_ALERT_MESSAGE: message },
  });
  if (r.error) return r.error.code === 'ETIMEDOUT' ? 'the alert command took over 20 s' : r.error.message;
  return r.status === 0 ? null : `the alert command exited with ${r.status}`;
}

// What an alert has cost (D128): each run counted on it is one that did not do its work. "5 runs lost since
// 2026-10-27 18:00", in local time.
export function lostRuns(a) {
  const d = new Date(a.openedAt);
  const pad = (x) => String(x).padStart(2, '0');
  return `${a.count} ${a.count === 1 ? 'run' : 'runs'} lost since ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// For SessionStart: the open alerts, to tell the user before anything else.
export function alertsContext(alerts) {
  return ['Heartbeat alerts: the autonomous runs of this project went wrong or keep being skipped. Tell the user about them first, in your first reply, before anything else, with what each one needs from them; `jerome heartbeat status` gives the detail. They close by themselves when a heartbeat ends well.', '',
    ...alerts.map((a) => `A${a.id}: ${a.reason} (${lostRuns(a)})`)].join('\n');
}
