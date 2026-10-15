// Moves a project created before D87 to the `.jerome/` layout (D89): Jérôme's state from the root into `.jerome/`,
// the marker file into `.jerome/project.json`, and the lead agent's instructions from the root CLAUDE.md into
// `.claude/rules/jerome.md` (brought by the template update that follows). Tracked files move with `git mv`, so
// their history follows them. Run once, by `jerome update`, after the user confirms.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { JEROME_DIR, PROJECT_FILE, STATE, NOTES_DIR, QUEUE, DB_FILE, DB_IGNORE, LEGACY } from './paths.js';

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// What the migration would do, as { moves, removeLead, keepLead, agents, gitignore, db }.
export function layoutPlan(dir) {
  const marker = readLegacyMarker(dir);
  const moves = [{ from: LEGACY.marker, to: PROJECT_FILE }];
  for (const [key, name] of Object.entries(LEGACY.state)) {
    if (existsSync(join(dir, name))) moves.push({ from: name, to: STATE[key] });
  }
  if (existsSync(join(dir, LEGACY.notes)) && statSync(join(dir, LEGACY.notes)).isDirectory()) moves.push({ from: LEGACY.notes, to: NOTES_DIR });
  if (existsSync(join(dir, LEGACY.queue))) moves.push({ from: LEGACY.queue, to: QUEUE });

  // The root CLAUDE.md goes only if it is still the template's: its hash matches the one recorded.
  const lead = join(dir, LEGACY.lead);
  const recorded = marker.files?.[LEGACY.lead];
  const removeLead = existsSync(lead) && recorded && sha(lead) === recorded;
  const keepLead = existsSync(lead) && !removeLead;

  const agents = [];
  const folder = join(dir, '.claude', 'agents');
  if (existsSync(folder)) {
    for (const file of readdirSync(folder).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(join(folder, file), 'utf8');
      if (text.includes(LEGACY.queue) || text.includes('`notes/')) agents.push(`.claude/agents/${file}`);
    }
  }
  const gitignorePath = join(dir, '.gitignore');
  const gitignore = existsSync(gitignorePath) && readFileSync(gitignorePath, 'utf8').split('\n').some((l) => l.trim() === LEGACY.dbIgnore);
  const db = existsSync(join(dir, LEGACY.db));
  return { moves, removeLead, keepLead, agents, gitignore, db };
}

export function describeLayoutPlan(plan) {
  const lines = plan.moves.map((m) => `  move        ${m.from} → ${m.to}`);
  if (plan.db) lines.push(`  move        ${LEGACY.db} → ${DB_FILE}`);
  if (plan.removeLead) lines.push(`  remove      ${LEGACY.lead} (the template's, replaced by .claude/rules/jerome.md)`);
  if (plan.keepLead) lines.push(`  keep        ${LEGACY.lead} (changed in this project: it stays as the project's own)`);
  for (const a of plan.agents) lines.push(`  paths       ${a} (${LEGACY.queue} → ${QUEUE}, notes/ → ${NOTES_DIR}/)`);
  if (plan.gitignore) lines.push(`  .gitignore  ${LEGACY.dbIgnore} → ${DB_IGNORE}`);
  return lines.join('\n');
}

function readLegacyMarker(dir) {
  const raw = readFileSync(join(dir, LEGACY.marker), 'utf8');
  return raw.trim() ? JSON.parse(raw) : { files: {} };
}

function tracked(dir, path) {
  return spawnSync('git', ['ls-files', '--error-unmatch', path], { cwd: dir, stdio: 'ignore' }).status === 0;
}

function move(dir, from, to) {
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  if (tracked(dir, from)) execFileSync('git', ['mv', from, to], { cwd: dir, stdio: 'ignore' });
  else renameSync(join(dir, from), join(dir, to));
}

// Something still running in the project: the move must wait, since the database and the files are in use.
export function busy(dir, lockPath) {
  if (lockPath && existsSync(lockPath)) return 'a heartbeat of this project is running';
  const db = join(dir, LEGACY.db);
  if (!existsSync(db)) return null;
  const d = new DatabaseSync(db, { readOnly: true });
  try {
    const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
    const open = d.prepare("SELECT count(*) n FROM runs WHERE kind = 'interactive' AND status = 'running' AND started_at >= ?").get(since).n;
    return open ? 'an interactive session is open in the project (close it, or wait for its run to end)' : null;
  } catch {
    return null;
  } finally {
    d.close();
  }
}

export function migrateLayout(dir, plan) {
  const marker = readLegacyMarker(dir);

  // The database first: a checkpoint folds the WAL into the main file, which then moves alone.
  if (plan.db) {
    const d = new DatabaseSync(join(dir, LEGACY.db));
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    d.close();
  }

  // The marker file becomes the folder of the same name: through a temporary name, so git keeps its history.
  const temp = '.jerome-project.json';
  move(dir, LEGACY.marker, temp);
  mkdirSync(join(dir, JEROME_DIR), { recursive: true });
  move(dir, temp, PROJECT_FILE);
  for (const m of plan.moves.slice(1)) move(dir, m.from, m.to);

  // The record: the root CLAUDE.md is no longer a template file; the budget that applied to it now applies to jerome.md.
  delete marker.files?.[LEGACY.lead];
  if (marker.budgets && LEGACY.lead in marker.budgets) {
    marker.budgets['jerome.md'] = marker.budgets[LEGACY.lead];
    delete marker.budgets[LEGACY.lead];
  }
  writeFileSync(join(dir, PROJECT_FILE), `${JSON.stringify(marker, null, 2)}\n`);

  if (plan.db) {
    renameSync(join(dir, LEGACY.db), join(dir, DB_FILE));
    for (const suffix of ['-wal', '-shm']) rmSync(join(dir, `${LEGACY.db}${suffix}`), { force: true });
  }
  if (plan.removeLead) {
    if (tracked(dir, LEGACY.lead)) execFileSync('git', ['rm', '-q', LEGACY.lead], { cwd: dir, stdio: 'ignore' });
    else rmSync(join(dir, LEGACY.lead));
  }
  if (plan.gitignore) {
    const path = join(dir, '.gitignore');
    writeFileSync(path, readFileSync(path, 'utf8').split('\n').map((l) => (l.trim() === LEGACY.dbIgnore ? DB_IGNORE : l)).join('\n'));
  }
  // Agents are the project's files (D42): only the two paths that moved are rewritten in them (D89).
  for (const file of plan.agents) {
    const path = join(dir, file);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(LEGACY.queue, QUEUE).replaceAll('`notes/', `\`${NOTES_DIR}/`));
  }
  // An emptied docs/ folder (it only held the queue) is left out too.
  const docs = join(dir, 'docs');
  if (existsSync(docs) && readdirSync(docs).length === 0) rmSync(docs, { recursive: true });
}
