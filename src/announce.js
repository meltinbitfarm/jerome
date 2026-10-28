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

export const LASTING_RUNS = 3;
export const LASTING_HOURS = 6;
const REMIND_HOURS = 24;

// Whether an open alert has lasted enough to call the user.
export function lasting(alert, now = new Date()) {
  return alert.count >= LASTING_RUNS || now.getTime() - Date.parse(alert.openedAt) >= LASTING_HOURS * 3_600_000;
}

// The sentence for a block, from the runner's reason: what is wrong and the one thing to do.
export function blockMessage(reason) {
  const r = String(reason ?? '');
  const m = (re) => r.match(re);
  let x;
  if (/^the folder is not trusted/.test(r)) return 'Claude Code does not trust the project\'s folder yet, so it cannot work there. Open `claude` in the folder once and accept.';
  if (/^PROJECT\.md is provisional/.test(r)) return 'The briefing is not finished. Open a session in the project and confirm it.';
  if (/^not a git repository/.test(r)) return 'The project has no first commit yet. Make one, and it starts by itself.';
  if ((x = m(/^uncommitted changes \(([^)]*)\) on \S+, not left by a heartbeat/))) return `There are changes of yours not committed (${x[1]}). Commit or discard them, and it starts by itself.`;
  if ((x = m(/^on branch (\S+), neither/))) return `The folder is on the branch ${x[1]}, not the main one. Switch back, and it starts by itself.`;
  if (/^detached HEAD/.test(r)) return 'The repository is on no branch (a detached HEAD). Switch back to the main branch.';
  if ((x = m(/^a ([a-z-]+) in progress/))) return `A git ${x[1]} was left half done. Finish it or abort it.`;
  if (/^jerome doctor failed/.test(r)) return 'Jérôme\'s setup in the project is broken. Run `jerome doctor` in the folder.';
  if (/^no slot /.test(r)) return 'A scheduled time no longer exists. Run `jerome heartbeat install` in the project.';
  if (/could not be committed/.test(r)) return 'Jérôme cannot commit its own files. Open a session to see why.';
  if (/permission denied for /.test(r)) return 'It stopped on something only you can do, such as a push or a deploy. Open a session to see what it needed.';
  if (/(^|→ )triage:/.test(r)) return 'The quick check before each run keeps failing. Open a session to see why.';
  if (capStop(r)) return 'It keeps stopping at its budget on the same work: the task may be too big. Open a session to split it, or raise its budget.';
  if (/max duration/.test(r)) return 'Its runs keep reaching their maximum duration. Open a session to see what is slow.';
  if (/^heartbeat of .* lost:/.test(r)) return 'Its runs end without finishing, as when the Mac sleeps or restarts in the middle. If it goes on, open a session.';
  if (/did not start/.test(r)) return 'Its scheduled runs do not start, as when the Mac is off or asleep. Check that the Mac stays on.';
  if (/end check/.test(r)) return 'It cannot finish its work cleanly: the last runs left it half done. Open a session and ask Jérôme what is stuck.';
  return 'Its runs keep stopping. Open a session and ask Jérôme what is wrong.';
}

// "for 7 h, 4 runs lost".
function howLong(alert, now) {
  const hours = Math.floor((now.getTime() - Date.parse(alert.openedAt)) / 3_600_000);
  const time = hours >= 48 ? `${Math.floor(hours / 24)} days` : hours >= 1 ? `${hours} h` : 'less than an hour';
  return `Stuck for ${time}, ${alert.count} ${alert.count === 1 ? 'run' : 'runs'} lost.`;
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
    const message = `${blockMessage(a.reason)} ${howLong(a, now)}`;
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
