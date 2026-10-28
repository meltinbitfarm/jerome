// How Jérôme reaches the user outside a session (D74, D128, D131): a macOS notification, and the Telegram bridge's
// queue when it is set up. JEROME_NOTIFY_LOG writes the notifications to a file instead, for tests.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { enqueue } from './telegram.js';

// Returns why the macOS notification could not be shown, or null. `outbox: false` when the message reaches
// Telegram another way, as a decision request does with its buttons.
// A null dir is a message about the account rather than a project, such as the quota running fast.
// `alert` ({ id, actions }) puts the block's buttons under the message on Telegram (D166).
export function notify(env, dir, message, { outbox = true, alert = null } = {}) {
  const project = dir ? basename(dir) : null;
  if (outbox) {
    try {
      enqueue({ dir, text: message, alert });
    } catch {
      // The queue is one more channel: a failure here never stops what notified.
    }
  }
  if (env.JEROME_NOTIFY_LOG) {
    writeFileSync(env.JEROME_NOTIFY_LOG, `${project ?? 'jerome'}: ${message}\n`, { flag: 'a' });
    return null;
  }
  if (env.JEROME_NOTIFY === 'off') return null;
  if (process.platform !== 'darwin') return 'notifications are shown on macOS only: set heartbeat.alerts.command';
  const quote = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`;
  const r = spawnSync('osascript', ['-e', `display notification ${quote(message)} with title ${quote(project ? `Jérôme · ${project}` : 'Jérôme')}`], { encoding: 'utf8', timeout: 5000 });
  if (r.error) return r.error.message;
  return r.status === 0 ? null : (r.stderr.trim() || `osascript exited with ${r.status}`);
}
