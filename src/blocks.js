// A block as the user reads it (D160, D161): one sentence with the one thing to do, in their language, and whether it
// has lasted enough to call them. Pure, so the Mac's notifications and the Director's dashboard say the same.
import { t, lang } from './i18n.js';
import { capStop } from './alerts.js';

export const LASTING_RUNS = 3;
export const LASTING_HOURS = 6;

// The blocks no run clears by itself, which wait for the user however often the project runs (D173): told at once.
const THE_USERS = ['untrusted', 'provisional', 'nogit', 'yours', 'branch', 'detached', 'operation', 'denied', 'commit', 'slot'];

// Whether an open alert is for the user now: one only they can clear, or any that has lasted (D160).
export function lasting(alert, now = new Date()) {
  if (alert.reason && THE_USERS.includes(blockKind(alert.reason).kind)) return true;
  return alert.count >= LASTING_RUNS || now.getTime() - Date.parse(alert.openedAt) >= LASTING_HOURS * 3_600_000;
}

// What kind of block a runner's reason is, with what its sentence names: { kind, values }. The kind picks the
// sentence (block.<kind>) and the actions offered from afar (D166).
export function blockKind(reason) {
  const r = String(reason ?? '');
  let x;
  if (/^the folder is not trusted/.test(r)) return { kind: 'untrusted' };
  if (/^PROJECT\.md is provisional/.test(r)) return { kind: 'provisional' };
  if (/^not a git repository/.test(r)) return { kind: 'nogit' };
  if ((x = r.match(/^uncommitted changes \(([^)]*)\) on \S+, not left by a heartbeat/))) return { kind: 'yours', values: { files: x[1] } };
  if ((x = r.match(/^on branch (\S+), neither/))) return { kind: 'branch', values: { branch: x[1] } };
  if (/^detached HEAD/.test(r)) return { kind: 'detached' };
  if ((x = r.match(/^a ([a-z-]+) in progress/))) return { kind: 'operation', values: { op: x[1] } };
  if (/^jerome doctor failed/.test(r)) return { kind: 'doctor' };
  if (/^no slot /.test(r)) return { kind: 'slot' };
  if (/could not be committed/.test(r)) return { kind: 'commit' };
  if ((x = r.match(/permission denied for (.+?): add the rules/))) return { kind: 'denied', values: { tools: x[1] } };
  if (/(^|→ )triage:/.test(r)) return { kind: 'triage' };
  if (capStop(r)) return { kind: 'cap' };
  if (/max duration/.test(r)) return { kind: 'duration' };
  if (/^heartbeat of .* lost:/.test(r)) return { kind: 'lost' };
  if (/did not start/.test(r)) return { kind: 'missed' };
  if (/end check/.test(r)) return { kind: 'endcheck' };
  return { kind: 'other' };
}

// The sentence for a block, from the runner's reason: what is wrong and the one thing to do, in the user's language.
export function blockMessage(reason, code = lang()) {
  const { kind, values = {} } = blockKind(reason);
  return t(`block.${kind}`, values, code);
}

// "Stuck for 7 h, 4 runs lost."
export function howLong(alert, now = new Date(), code = lang()) {
  const hours = Math.floor((now.getTime() - Date.parse(alert.openedAt)) / 3_600_000);
  const time = hours >= 48 ? t('time.days', { n: Math.floor(hours / 24) }, code) : hours >= 1 ? t('time.hours', { n: hours }, code) : t('time.short', {}, code);
  return t('block.since', { time, runs: alert.count }, code);
}
