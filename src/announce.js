// What reaches the user about blocks (D160, D161). An alert is recorded as soon as something stops the runs, for
// `jerome heartbeat status` and the dashboard; the user hears of it only when it lasts, three runs in a row or six
// hours, and then as one sentence written for a person, with the one thing to do. Never the runner's reason, a
// path, a token count or a command line. A reminder follows once a day while it stays open.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { notify } from './notify.js';
import { openAlerts, pushAlert, capStop } from './alerts.js';
import { cacheDir } from './runstate.js';
import { jobLabel } from './schedule.js';
import { openDb } from './db.js';
import { t, lang } from './i18n.js';

export const LASTING_RUNS = 3;
export const LASTING_HOURS = 6;
const REMIND_HOURS = 24;

// Whether an open alert has lasted enough to call the user.
export function lasting(alert, now = new Date()) {
  return alert.count >= LASTING_RUNS || now.getTime() - Date.parse(alert.openedAt) >= LASTING_HOURS * 3_600_000;
}

// The sentence for a block, from the runner's reason: what is wrong and the one thing to do, in the user's language.
export function blockMessage(reason, code = lang()) {
  const r = String(reason ?? '');
  const say = (key, values) => t(key, values, code);
  let x;
  if (/^the folder is not trusted/.test(r)) return say('block.untrusted');
  if (/^PROJECT\.md is provisional/.test(r)) return say('block.provisional');
  if (/^not a git repository/.test(r)) return say('block.nogit');
  if ((x = r.match(/^uncommitted changes \(([^)]*)\) on \S+, not left by a heartbeat/))) return say('block.yours', { files: x[1] });
  if ((x = r.match(/^on branch (\S+), neither/))) return say('block.branch', { branch: x[1] });
  if (/^detached HEAD/.test(r)) return say('block.detached');
  if ((x = r.match(/^a ([a-z-]+) in progress/))) return say('block.operation', { op: x[1] });
  if (/^jerome doctor failed/.test(r)) return say('block.doctor');
  if (/^no slot /.test(r)) return say('block.slot');
  if (/could not be committed/.test(r)) return say('block.commit');
  if (/permission denied for /.test(r)) return say('block.denied');
  if (/(^|→ )triage:/.test(r)) return say('block.triage');
  if (capStop(r)) return say('block.cap');
  if (/max duration/.test(r)) return say('block.duration');
  if (/^heartbeat of .* lost:/.test(r)) return say('block.lost');
  if (/did not start/.test(r)) return say('block.missed');
  if (/end check/.test(r)) return say('block.endcheck');
  return say('block.other');
}

// "Stuck for 7 h, 4 runs lost."
export function howLong(alert, now = new Date(), code = lang()) {
  const hours = Math.floor((now.getTime() - Date.parse(alert.openedAt)) / 3_600_000);
  const time = hours >= 48 ? t('time.days', { n: Math.floor(hours / 24) }, code) : hours >= 1 ? t('time.hours', { n: hours }, code) : t('time.short', {}, code);
  return t('block.since', { time, runs: alert.count }, code);
}

// The project's open alerts that have lasted, announced once and reminded once a day: a notification (macOS and
// Telegram) and the project's push command. Called after each heartbeat and by the watchdog every minute.
export function announceAlerts(dir, { env = process.env, config = null, now = new Date(), log = () => {} } = {}) {
  const db = openDb(dir);
  if (!db) return;
  let alerts;
  try {
    alerts = openAlerts(db);
  } finally {
    db.close();
  }
  const path = cacheDir('notified', `${jobLabel(dir)}.alerts.json`);
  let sent = {};
  try {
    sent = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // None sent yet.
  }
  const due = alerts.filter((a) => lasting(a, now) && (!sent[a.id] || now.getTime() - Date.parse(sent[a.id]) >= REMIND_HOURS * 3_600_000));
  if (!due.length) return;
  for (const a of due) {
    const code = lang(env);
    const message = `${blockMessage(a.reason, code)} ${howLong(a, now, code)}`;
    log(`alert A${a.id} told to the user: ${message}`);
    sent[a.id] = now.toISOString();
    const unseen = notify(env, dir, message);
    if (unseen) log(`alert notification failed: ${unseen}`);
    const failed = pushAlert(config?.alerts?.command, { project: basename(dir), dir, message: `Jérôme · ${basename(dir)} · ${message}`, env });
    if (failed) log(`alert push failed: ${failed}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sent)}\n`);
}
