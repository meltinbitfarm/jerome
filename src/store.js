// Where a project's database lives (D93): outside the working tree, so no checkout, branch switch or `git clean`
// can remove it. Each clone has its own, found from the path of its main folder: the worktrees of a clone share
// it, two clones of the same repository do not. Nothing about it is versioned. Next to the database a record
// keeps the folder it belongs to and the repository's fingerprint, so `doctor` can relink a project that moved
// and report the databases of projects that are gone.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PROJECT_FILE } from './paths.js';

export const STORE_SCHEMA = 'jerome.store/v1';
export const STORE_DB = 'jerome.db';
const RECORD = 'record.json';

// Where databases are copied before a move or a removal, outside both the working tree and the store.
export function backupsDir() {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'jerome', 'backups');
}

export function storesHome() {
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'jerome', 'projects');
}

const git = (dir, args) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

// The clone's main folder: the parent of `git rev-parse --git-common-dir`, which a worktree shares with its clone.
// A folder without git is its own.
export function cloneRoot(dir) {
  const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return real(dir);
  return real(basename(common) === '.git' ? dirname(common) : common);
}

export function storeKey(root) {
  return `${basename(root)}-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
}

export function storeDir(dir) {
  return join(storesHome(), storeKey(cloneRoot(dir)));
}

// What tells a moved clone from another repository: its first commit and its remote.
export function fingerprint(dir) {
  const roots = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
  return { rootCommit: roots ? roots.split('\n').sort()[0] : null, remote: git(dir, ['remote', 'get-url', 'origin']) };
}

export function readRecord(store) {
  try {
    return JSON.parse(readFileSync(join(store, RECORD), 'utf8'));
  } catch {
    return null;
  }
}

export function writeRecord(dir, store = storeDir(dir)) {
  const old = readRecord(store);
  mkdirSync(store, { recursive: true });
  const record = { schema: STORE_SCHEMA, path: cloneRoot(dir), fingerprint: fingerprint(dir), created: old?.created ?? new Date().toISOString() };
  writeFileSync(join(store, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

// A database created before the first commit has no fingerprint yet: the first write after it completes the record,
// so the project can be recognised if it moves. Only the record is read until then; git runs only while it lacks one.
export function completeRecord(dir) {
  const store = storeDir(dir);
  if (!existsSync(join(store, STORE_DB))) return;
  const record = readRecord(store);
  if (record?.fingerprint?.rootCommit) return;
  try {
    writeRecord(dir, store);
  } catch {
    // The record is a help for doctor: a write that fails never stops the caller.
  }
}

// Every database in the store, with its record: { key, dir, record, orphan }. A database is orphan when the folder
// its record names no longer exists or is no longer a Jérôme project.
export function stores() {
  const home = storesHome();
  if (!existsSync(home)) return [];
  return readdirSync(home)
    .map((key) => ({ key, dir: join(home, key) }))
    .filter((s) => statSync(s.dir).isDirectory() && existsSync(join(s.dir, STORE_DB)))
    .map((s) => {
      const record = readRecord(s.dir);
      const orphan = !record?.path || !existsSync(join(record.path, PROJECT_FILE)) || storeKey(record.path) !== s.key;
      return { ...s, record, orphan };
    });
}

// The orphan databases that may be this project's, moved: same first commit, and the same remote when both have one.
export function candidates(dir) {
  const mine = fingerprint(dir);
  if (!mine.rootCommit) return [];
  const own = storeDir(dir);
  return stores().filter((s) => s.orphan && s.dir !== own && s.record?.fingerprint?.rootCommit === mine.rootCommit
    && !(mine.remote && s.record.fingerprint.remote && mine.remote !== s.record.fingerprint.remote));
}

// The database of a moved project becomes this folder's: the store folder is renamed, the record rewritten.
export function relink(dir, store) {
  const target = storeDir(dir);
  if (existsSync(join(target, STORE_DB))) throw new Error(`${target} already holds a database`);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(store.dir, target);
  writeRecord(dir, target);
  return target;
}

export function describeStore(s) {
  return `${s.key} (was ${s.record?.path ?? 'unknown folder'})`;
}

// Its runs and the start of the last one, read without writing: the database stays as it is.
export function storeSummary(s) {
  let db;
  try {
    db = new DatabaseSync(join(s.dir, STORE_DB), { readOnly: true });
    const r = db.prepare('SELECT count(*) n, max(started_at) last FROM runs').get();
    return `${r.n} ${r.n === 1 ? 'run' : 'runs'}${r.last ? `, the last on ${r.last.slice(0, 10)}` : ''}`;
  } catch {
    return 'unreadable';
  } finally {
    db?.close();
  }
}

// Removes the database of a project that is gone, after a backup outside the store. Only an orphan can go.
export function forget(key, backupDir) {
  const s = stores().find((x) => x.key === key);
  if (!s) throw new Error(`there is no database ${key} in ${storesHome()}`);
  if (!s.orphan) throw new Error(`${key} belongs to ${s.record.path}, which is still a Jérôme project: it is not removed`);
  const db = new DatabaseSync(join(s.dir, STORE_DB));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  mkdirSync(backupDir, { recursive: true });
  const backup = join(backupDir, `${key}-forgotten-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  copyFileSync(join(s.dir, STORE_DB), backup);
  rmSync(s.dir, { recursive: true });
  return { store: s, backup };
}
