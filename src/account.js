// Account-wide data (D52): the latest reading of the subscription windows and the global limits, in
// ~/.config/jerome/account.json. Written by `jerome statusline` and the heartbeat runner, only when a value
// changes, through a temporary file and a rename, so a reader never sees half a file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const ACCOUNT_SCHEMA = 'jerome.account/v1';
export const WINDOWS = ['five_hour', 'seven_day'];

export function accountPath() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jerome', 'account.json');
}

export function readAccount(path = accountPath()) {
  const empty = { schema: ACCOUNT_SCHEMA, windows: {}, limits: {} };
  if (!existsSync(path)) return empty;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.schema !== ACCOUNT_SCHEMA) throw new Error(`${path} has schema ${data.schema ?? 'none'}, this Jérôme reads ${ACCOUNT_SCHEMA}`);
  return { ...empty, ...data };
}

// Records a reading of one or both windows, e.g. { five_hour: { used: 43, resetsAt: 1791998400 } }.
// Returns true if something changed and the file was written.
export function recordWindows(reading, { source, now = new Date(), path = accountPath() }) {
  const account = readAccount(path);
  let changed = false;
  for (const name of WINDOWS) {
    const next = reading[name];
    if (!next) continue;
    const current = account.windows[name];
    if (current && current.used === next.used && current.resetsAt === next.resetsAt) continue;
    account.windows[name] = { used: next.used, resetsAt: next.resetsAt, readAt: now.toISOString(), source };
    changed = true;
  }
  if (changed) writeAccount(account, path);
  return changed;
}

export function writeAccount(account, path = accountPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(account, null, 2)}\n`);
  renameSync(temp, path);
}
