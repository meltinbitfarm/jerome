// A block as the user reads it (D160, D161): one sentence with the one thing to do, in their language, and whether it
// has lasted enough to call them. Pure, so the Mac's notifications and the Director's dashboard say the same.
import { t, lang } from './i18n.js';
import { capStop } from './alerts.js';

export const LASTING_RUNS = 3;
export const LASTING_HOURS = 6;

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
