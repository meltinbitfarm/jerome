// The project database (D51, D54, D93): outside the working tree, in the store of store.js, written only by the CLI
// and the hooks (D56). The schema version is SQLite's `user_version`; numbered migrations in the package bring
// it up to date, each in its own transaction.
import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, openSync, readSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TREE_DB } from './paths.js';
import { storeDir, writeRecord, completeRecord, STORE_DB } from './store.js';

// How messages name it, now that its path is not the project's.
export const DB_FILE = 'the project database';
export const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

// Retention (D55): usage rows are summed into usage_daily after 90 days; events and transcript offsets
// are deleted after 30. Runs and decision requests are kept.
export const USAGE_DAYS = 90;
export const EVENT_DAYS = 30;

export class DbTooNewError extends Error {
  constructor(version, latest) {
    super(`The project database has schema version ${version}, this Jérôme knows up to ${latest}: update Jérôme`);
    this.version = version;
    this.latest = latest;
  }
}

// The migrations in the package, as { version, name, sql }, in order. Their numbers must run 1, 2, 3… without gaps.
export function migrations(dir = MIGRATIONS_DIR) {
  const list = readdirSync(dir)
    .filter((f) => /^\d{3}-[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: Number(f.slice(0, 3)), name: f, sql: readFileSync(join(dir, f), 'utf8') }));
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migration ${m.name} is out of sequence: expected number ${i + 1}`);
  });
  return list;
}

export const LATEST = migrations().length;

// The database in the store; until `jerome update` moves it there, the one a project still has in .jerome/ (D93),
// so nothing is lost in between.
export function dbPath(dir) {
  const stored = join(storeDir(dir), STORE_DB);
  if (!existsSync(stored) && treeDb(dir)) return join(dir, TREE_DB);
  return stored;
}

// A database still in the working tree (D87-D92), which `jerome update` moves to the store.
export function treeDb(dir) {
  return existsSync(join(dir, TREE_DB));
}

// Opens the project database. With create, a missing file is created; with migrate, pending migrations are applied.
// Returns null when the file is missing and create is false. A database newer than this package is never written.
export function openDb(dir, { create = false, migrate = true, readOnly = false } = {}) {
  const path = dbPath(dir);
  if (!existsSync(path) && !create) return null;
  // A new database in the store gets its record: the folder it belongs to and the repository's fingerprint.
  if (create && !existsSync(path)) writeRecord(dir);
  else if (!readOnly) completeRecord(dir);
  const db = new DatabaseSync(path, { readOnly });
  db.exec('PRAGMA busy_timeout = 5000');
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  const version = schemaVersion(db);
  if (version > LATEST) {
    db.close();
    throw new DbTooNewError(version, LATEST);
  }
  if (migrate && !readOnly) applyMigrations(db);
  return db;
}

// The schema version read from the file header (user_version, bytes 60-63), without opening the database:
// even a read-only connection to a WAL database creates its -shm file, and `doctor --check` writes nothing.
// The last connection to close checkpoints the WAL, so the header is current whenever no writer is running.
export function peekVersion(dir) {
  const fd = openSync(dbPath(dir), 'r');
  try {
    const header = Buffer.alloc(100);
    if (readSync(fd, header, 0, 100, 0) < 100 || header.toString('latin1', 0, 15) !== 'SQLite format 3') {
      throw new Error(`${dbPath(dir)} is not a SQLite database`);
    }
    return header.readUInt32BE(60);
  } finally {
    closeSync(fd);
  }
}

export function schemaVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

// Applies the migrations above the database's version and returns the names of those applied.
export function applyMigrations(db, list = migrations()) {
  const applied = [];
  for (const m of list) {
    if (m.version <= schemaVersion(db)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Another writer may have applied it while this one waited for the lock.
      if (m.version > schemaVersion(db)) {
        db.exec(m.sql);
        db.exec(`PRAGMA user_version = ${m.version}`);
        applied.push(m.name);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${m.name} failed: ${err.message}`);
    }
  }
  return applied;
}

// Applies the retention policy (D55). Old usage rows are summed into usage_daily in the same transaction
// that deletes them, so totals never change.
export function prune(db, now = new Date()) {
  const usageCutoff = daysBefore(now, USAGE_DAYS);
  const eventCutoff = daysBefore(now, EVENT_DAYS);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO usage_daily (day, agent, model, requests, input, output, cache_read, cache_write_5m, cache_write_1h)
      SELECT substr(at, 1, 10), agent, model, count(*), sum(input), sum(output), sum(cache_read), sum(cache_write_5m), sum(cache_write_1h)
      FROM usage WHERE at < ? GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
      ON CONFLICT (day, agent, model) DO UPDATE SET
        requests = requests + excluded.requests, input = input + excluded.input, output = output + excluded.output,
        cache_read = cache_read + excluded.cache_read, cache_write_5m = cache_write_5m + excluded.cache_write_5m,
        cache_write_1h = cache_write_1h + excluded.cache_write_1h`).run(usageCutoff);
    const usage = db.prepare('DELETE FROM usage WHERE at < ?').run(usageCutoff).changes;
    const events = db.prepare('DELETE FROM events WHERE at < ?').run(eventCutoff).changes;
    const reads = db.prepare('DELETE FROM transcript_reads WHERE updated_at < ?').run(eventCutoff).changes;
    db.exec('COMMIT');
    return { usage, events, reads };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function daysBefore(now, days) {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
