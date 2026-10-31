// What the user unlocked for a project (D194, D195), kept in the project's store, outside the repository, so no run
// changes it with a commit: { push: { at }, 'deploy-fly': { at } }.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { storeDir } from './store.js';

const unlockedPath = (dir) => join(storeDir(dir), 'unlocked.json');

export function unlocked(dir) {
  try {
    return JSON.parse(readFileSync(unlockedPath(dir), 'utf8'));
  } catch {
    return {};
  }
}

export const isUnlocked = (dir, name) => Boolean(unlocked(dir)[name]);

export function saveUnlocked(dir, data) {
  mkdirSync(storeDir(dir), { recursive: true });
  if (!Object.keys(data).length) rmSync(unlockedPath(dir), { force: true });
  else writeFileSync(unlockedPath(dir), `${JSON.stringify(data, null, 2)}\n`);
}
