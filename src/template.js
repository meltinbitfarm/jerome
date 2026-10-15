// The template files of a project and the `.jerome` marker that records them (D30).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

export const TEMPLATE_DIR = join(import.meta.dirname, '..', 'template');
const PACKAGE = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
export const VERSION = PACKAGE.version;

// Version of the `.jerome` file. Adding fields keeps it; renaming or removing fields bumps it.
export const MARKER_SCHEMA = 'jerome.project/v1';
export const MARKER = '.jerome';

// Project state: never copied or overwritten from the template, even if a MANIFEST listed it (D30).
export const STATE_FILES = ['PROJECT.md', 'decisions.md', 'open.md', 'archive.md', 'brief.md', MARKER, '.claude/settings.local.json'];

// Jérôme's own development repository is a Jérôme project too, but it holds the template in `template/`
// instead of a copy at its root: template checks and updates do not apply there.
export function isJeromeRepo(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return pkg.name === PACKAGE.name && existsSync(join(dir, 'template', 'MANIFEST'));
  } catch {
    return false;
  }
}

export function readManifest(templateDir) {
  return readFileSync(join(templateDir, 'MANIFEST'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((entry) => {
      const clean = normalize(entry).replace(/\/$/, '');
      if (clean.startsWith('..') || clean.startsWith('/')) throw new Error(`Invalid path in MANIFEST: ${entry}`);
      if (isState(clean)) throw new Error(`The MANIFEST lists a project state path, which the template never touches: ${entry}`);
      return clean;
    });
}

function isState(path) {
  return STATE_FILES.some((s) => s === path || s.startsWith(`${path}/`)) || path === '.git' || path.startsWith('.git/');
}

// The files covered by the MANIFEST, as paths relative to `dir`. A folder entry covers every file in it.
export function manifestFiles(dir, entries) {
  const files = [];
  const walk = (rel) => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) if (name !== '.DS_Store') walk(join(rel, name));
    } else files.push(rel);
  };
  for (const entry of entries) walk(entry);
  return files;
}

export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Reads `.jerome`. Projects created before D30 have an empty marker: they get an empty record.
export function readMarker(dir) {
  const raw = readFileSync(join(dir, MARKER), 'utf8');
  if (!raw.trim()) return { schema: MARKER_SCHEMA, jerome: null, files: {} };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${MARKER} is not valid JSON`);
  }
  if (data.schema !== MARKER_SCHEMA) throw new Error(`${MARKER} has schema ${data.schema ?? 'none'}, this Jérôme reads ${MARKER_SCHEMA}: update Jérôme`);
  return { ...data, files: data.files ?? {} };
}

export function writeMarker(dir, files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(dir, MARKER), `${JSON.stringify({ schema: MARKER_SCHEMA, jerome: VERSION, files: sorted }, null, 2)}\n`);
}

// Compares a project with the installed template. For each template file, `files` in `.jerome` holds the hash
// of the template version the project file was last reconciled with (its base). The status of each file:
//   same      the project file equals the installed template
//   new       the file is missing from the project
//   update    the project file is unchanged since its base, and the template has changed: safe to replace
//   modified  the project file was changed in the project, and the template has changed since: replace only on request
//   kept      the project file was changed in the project, and the user already chose to keep it against this template
// `dropped` lists project files that the installed template no longer has: they are reported, never deleted.
export function templatePlan(dir, templateDir = TEMPLATE_DIR) {
  const marker = readMarker(dir);
  const entries = readManifest(templateDir);
  const files = manifestFiles(templateDir, entries).map((path) => {
    const template = hashFile(join(templateDir, path));
    const target = join(dir, path);
    const base = marker.files[path] ?? null;
    if (!existsSync(target)) return { path, status: 'new', template, base };
    const project = hashFile(target);
    let status;
    if (project === template) status = 'same';
    else if (project === base) status = 'update';
    else if (base === template) status = 'kept';
    else status = 'modified';
    return { path, status, template, base };
  });

  const known = new Set(files.map((f) => f.path));
  let oldEntries = [];
  try {
    oldEntries = readManifest(dir);
  } catch {
    // A project without its MANIFEST copy, or with an unreadable one: only the folders listed now are scanned.
  }
  const dropped = manifestFiles(dir, [...new Set([...oldEntries, ...entries])]).filter((p) => !known.has(p) && !isState(p));
  return { marker, files, dropped };
}

// Files that need attention: what `jerome doctor` warns about and `jerome update` offers.
export function behind(plan) {
  return plan.files.filter((f) => f.status === 'new' || f.status === 'update' || f.status === 'modified');
}

// The record written after a copy or an update: every file that now equals the template, or that the user
// chose to keep against it, is reconciled with the installed version; the others keep their previous base.
export function reconciled(dir, plan, kept = []) {
  const files = {};
  for (const f of plan.files) {
    const target = join(dir, f.path);
    const now = existsSync(target) ? hashFile(target) : null;
    if (now === f.template || kept.includes(f.path) || f.status === 'kept') files[f.path] = f.template;
    else if (f.base) files[f.path] = f.base;
  }
  return files;
}
