// `jerome docs`: runs the documentarist headless on the documentation queue (D25, D43), as a service call:
// from a fixed service folder outside the project, so it loads neither CLAUDE.md nor PROJECT.md and leaves
// no transcript, with the project's lean profile, and with write access only to the project's docs/.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { runClaude } from './claude.js';
import { MARKER } from './template.js';
import { QUEUE, documentarist, queueEntries } from './agents.js';
import { settingsPath } from './profile.js';
import { openDb } from './db.js';

export async function docs(dirArg) {
  const dir = resolve(dirArg);
  if (!existsSync(join(dir, MARKER))) {
    console.error(`${dir} is not a Jérôme project (the ${MARKER} marker is missing).`);
    return 1;
  }
  const before = queueEntries(dir).length;
  if (!before) {
    console.log(`✓ ${QUEUE} has no entries: the documentation is up to date.`);
    return 0;
  }
  const settings = settingsPath(dir);
  if (!existsSync(settings)) {
    console.error(`${settings} is missing: run \`jerome doctor\` first, so the call runs with the lean profile.`);
    return 1;
  }

  const agent = documentarist(dir);
  const model = agent.meta.model || 'haiku';
  const tools = (agent.meta.tools || 'Read, Edit, Write, Grep, Glob').split(',').map((t) => t.trim()).filter(Boolean);
  const definition = { documentarist: { description: agent.meta.description ?? 'Documentarist', prompt: agent.body, tools, model } };
  // Absolute path rules start with `//`: the documentarist may write only inside the project's docs/.
  const allowed = ['Read', 'Grep', 'Glob', `Edit(/${dir}/docs/**)`, `Write(/${dir}/docs/**)`];
  const task = `The project folder is ${dir}. Bring the entries of ${join(dir, QUEUE)} into the documentation in ${join(dir, 'docs')}. Use absolute paths.`;

  const cwd = serviceFolder(dir);
  console.log(`Documentarist (${model}${agent.own ? '' : ', from the catalog'}) on ${before} ${before === 1 ? 'entry' : 'entries'}...`);
  let out;
  try {
    out = runClaude([
      '-p', task,
      '--agents', JSON.stringify(definition), '--agent', 'documentarist', '--model', model,
      '--tools', tools.join(','), '--allowedTools', ...allowed,
      '--add-dir', dir, '--settings', settings,
      '--no-session-persistence', '--output-format', 'json',
    ], { cwd, timeout: 600_000 });
  } catch (err) {
    console.error(err.message);
    return 1;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  let result;
  try {
    result = JSON.parse(out);
  } catch {
    console.error('The documentarist did not return a readable result.');
    return 1;
  }
  console.log(String(result.result ?? '').trim());
  recordServiceRun(dir, result, agent.meta.name ?? 'documentarist');
  const after = queueEntries(dir).length;
  console.log(`${after ? '!' : '✓'} ${QUEUE}: ${before - after} of ${before} ${before === 1 ? 'entry' : 'entries'} integrated${after ? `, ${after} left` : ''}`);
  return result.is_error ? 1 : 0;
}

// One fixed folder per project, emptied before each call: Claude Code keeps a memory folder in ~/.claude/projects/
// for every folder it starts from, so a new temporary folder each time would leave a new one behind.
export function serviceFolder(dir) {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  const id = createHash('sha256').update(dir).digest('hex').slice(0, 8);
  const folder = join(cache, 'jerome', 'service', `${basename(dir)}-${id}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  return folder;
}

// Service calls leave no transcript and run outside the project, so its hooks never see them: the CLI records the
// run itself, with one usage row per model from the result (D56, D63). Recording never fails the command.
export function recordServiceRun(dir, result, agent, now = new Date()) {
  let db;
  try {
    db = openDb(dir);
    if (!db) return;
    db.exec('BEGIN IMMEDIATE');
    const runId = db.prepare("INSERT INTO runs (kind, started_at, ended_at, status) VALUES ('service', ?, ?, ?)")
      .run(new Date(now.getTime() - (result.duration_ms ?? 0)).toISOString(), now.toISOString(), result.is_error ? 'failed' : 'done').lastInsertRowid;
    recordResultUsage(db, runId, result, agent, now);
    db.exec('COMMIT');
  } catch {
    try {
      db?.exec('ROLLBACK');
    } catch {
      // Nothing to roll back.
    }
  } finally {
    db?.close();
  }
}

// The usage of a `claude -p --output-format json` result, one row per model, attached to a run. modelUsage does
// not split cache writes by duration: they are counted as 1-hour writes, the kind Claude Code uses.
export function recordResultUsage(db, runId, result, agent, now = new Date()) {
  const insert = db.prepare(`INSERT OR IGNORE INTO usage (request_id, run_id, agent, model, input, output, cache_read, cache_write_1h, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [model, u] of Object.entries(result.modelUsage ?? {})) {
    insert.run(`service:${runId}:${agent}:${model}`, runId, agent, model, u.inputTokens ?? 0, u.outputTokens ?? 0,
      u.cacheReadInputTokens ?? 0, u.cacheCreationInputTokens ?? 0, now.toISOString());
  }
}
