// Where Jérôme keeps things in a project (D87): all its state in `.jerome/`, the lead agent's instructions in
// `.claude/rules/jerome.md`. The project's root, its CLAUDE.md and its docs/ stay the project's own.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const JEROME_DIR = '.jerome';
export const PROJECT_FILE = '.jerome/project.json';
export const LEAD_FILE = '.claude/rules/jerome.md';
export const STATE = {
  project: '.jerome/PROJECT.md',
  scope: '.jerome/scope.md',
  areas: '.jerome/areas.md',
  decisions: '.jerome/decisions.md',
  open: '.jerome/open.md',
  archive: '.jerome/archive.md',
  brief: '.jerome/brief.md',
  digest: '.jerome/digest.md',
};
export const NOTES_DIR = '.jerome/notes';
export const QUEUE = '.jerome/docs-queue.md';
// The database lived here from D87 to D93; it now lives outside the working tree (store.js). The line stays in
// .gitignore, so a Jérôme from before D93 never puts it in git.
export const TREE_DB = '.jerome/jerome.db';
export const DB_IGNORE = '.jerome/jerome.db*';

// Before D87 the marker was a file named `.jerome` at the root, next to the state files.
export const LEGACY = {
  marker: '.jerome',
  lead: 'CLAUDE.md',
  state: Object.fromEntries(Object.entries(STATE).map(([k, v]) => [k, v.slice(JEROME_DIR.length + 1)])),
  notes: 'notes',
  queue: 'docs/_pending.md',
  db: '.jerome.db',
  dbIgnore: '.jerome.db*',
};

export function isProject(dir) {
  return existsSync(join(dir, PROJECT_FILE));
}

// A project created before D87: `.jerome` is a file, not a folder.
export function isLegacy(dir) {
  const path = join(dir, LEGACY.marker);
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function notProjectMessage(dir) {
  return isLegacy(dir)
    ? `${dir} uses the layout from before Jérôme kept its files in .jerome/: run \`jerome update\` to move them.`
    : `${dir} is not a Jérôme project (${PROJECT_FILE} is missing).`;
}
