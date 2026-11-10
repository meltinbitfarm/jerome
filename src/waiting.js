// What holds a project up waiting for the user (D209): the triage, when it finds no task, names what only the user
// can do, in their language. It is kept per project, outside the tree, shown on the Director's dashboard and told
// once on Telegram, again only when it changes. A triage that finds work clears it: the project moves by itself.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { cacheDir } from './runstate.js';
import { jobLabel } from './schedule.js';
import { scrub } from './scrub.js';

export const WAITING_ITEMS = 5;
const WAITING_TEXT = 300;

const waitingPath = (dir) => cacheDir('heartbeat', `${jobLabel(dir)}-waiting.json`);

export function readWaiting(dir) {
  try {
    const w = JSON.parse(readFileSync(waitingPath(dir), 'utf8'));
    return Array.isArray(w.items) && w.items.length ? w : null;
  } catch {
    return null;
  }
}

// The items as the triage gave them, cleaned: texts only, no path, at most WAITING_ITEMS.
export function waitingItems(list) {
  return (Array.isArray(list) ? list : []).filter((x) => typeof x === 'string').map((x) => scrub(x).slice(0, WAITING_TEXT)).filter(Boolean).slice(0, WAITING_ITEMS);
}

// Keeps what the project waits for, or clears it with an empty list. Returns the items when they are new, for the
// one message that tells them, else null.
export function writeWaiting(dir, items, now = new Date()) {
  const path = waitingPath(dir);
  if (!items.length) {
    if (existsSync(path)) rmSync(path, { force: true });
    return null;
  }
  const hash = createHash('sha256').update(JSON.stringify([...items].sort())).digest('hex').slice(0, 16);
  const was = readWaiting(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ items, hash, at: was?.hash === hash ? was.at : now.toISOString() })}\n`);
  return was?.hash === hash ? null : items;
}
