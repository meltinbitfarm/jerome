// Where a Mac stands with Jérôme Director (D145, D149): its link (`jerome connect`), what the last beats left in its
// state, and from them its mode. Directed while the Director decides and answered within SILENT_MS; local, at a
// reduced pace, when it has been silent longer; null when not connected or when the Director only observes, and
// the Mac keeps phase 1. Apart from directorlink.js so the governor and the heartbeat can ask without importing it.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cacheDir } from './runstate.js';
import { GOVERNOR_DEFAULTS } from './pacing.js';

// With no valid signed answer for this long, a Mac goes back to local mode (D149).
export const SILENT_MS = 5 * 60_000;

export function linkPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jerome', 'director.json');
}
export const statePath = () => cacheDir('director', 'state.json');
export const permitsPath = () => cacheDir('director', 'permits.json');

export function readLink(env = process.env) {
  try {
    return JSON.parse(readFileSync(linkPath(env), 'utf8'));
  } catch {
    return null;
  }
}

export function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return { cursors: {} };
  }
}

// { mode: 'directed' | 'local', settings, since } or null.
export function directorMode(env = process.env, now = new Date()) {
  if (!readLink(env)) return null;
  const s = readState();
  if (s.status !== 'approved' || s.mode !== 'directing') return null;
  const fresh = Boolean(s.lastOk) && now.getTime() - Date.parse(s.lastOk) <= SILENT_MS;
  return { mode: fresh ? 'directed' : 'local', settings: { ...GOVERNOR_DEFAULTS, ...s.settings }, since: fresh ? null : s.lastOk ?? null };
}

// The permits this Mac accepted (D148), by id, with the project's folder, which never leaves the Mac.
export function readPermits() {
  try {
    return JSON.parse(readFileSync(permitsPath(), 'utf8'));
  } catch {
    return {};
  }
}

export function grantedPermit(id) {
  return readPermits()[id] ?? null;
}
