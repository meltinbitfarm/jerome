// What reaches the user about blocks (D160, D161). An alert is recorded as soon as something stops the runs, for
// `jerome heartbeat status` and the dashboard; the user hears of it only when it lasts, three runs in a row or six
// hours, and then as one sentence written for a person, with the one thing to do. Never the runner's reason, a
// path, a token count or a command line. A reminder follows once a day while it stays open.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { notify } from './notify.js';
import { openAlerts, pushAlert } from './alerts.js';
import { blockMessage, howLong, lasting } from './blocks.js';
export { blockMessage, howLong, lasting };
import { cacheDir } from './runstate.js';
import { jobLabel } from './schedule.js';
import { openDb } from './db.js';
import { lang } from './i18n.js';
import { actionsFor } from './unblock.js';

const REMIND_HOURS = 24;

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
    const unseen = notify(env, dir, message, { alert: { id: a.id, actions: actionsFor(a.reason) } });
    if (unseen) log(`alert notification failed: ${unseen}`);
    const failed = pushAlert(config?.alerts?.command, { project: basename(dir), dir, message: `Jérôme · ${basename(dir)} · ${message}`, env });
    if (failed) log(`alert push failed: ${failed}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sent)}\n`);
}
