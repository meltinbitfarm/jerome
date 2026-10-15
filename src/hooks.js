// `jerome hook <event>`: what Claude Code's hooks run (D59). They write runs, usage and events to the project
// database and never make a session fail: every error ends in exit code 0, recorded as an `error` event when the
// database can be reached. Each event records how long the hook took, from process start (`ms`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { MARKER } from './template.js';
import { openDb, prune } from './db.js';
import { ingestTranscript } from './usage.js';
import { checkChain } from './chain.js';

export const HOOK_EVENTS = ['session-start', 'subagent-stop', 'stop', 'session-end', 'pre-tool-use'];
const RUN_KINDS = ['heartbeat', 'service'];

export async function hook(event, { input = readStdin(), env = process.env } = {}) {
  // Jérôme's own checks, such as doctor's /context, run Claude Code with the hooks off.
  if (env.JEROME_HOOKS === 'off') return 0;
  let payload;
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    return 0;
  }
  const dir = projectDir(payload, env);
  if (!dir) return 0;

  // The chain check needs no database, and runs before every Bash call: it opens the database only to log a refusal.
  if (event === 'pre-tool-use') {
    if (payload.tool_name !== 'Bash') return 0;
    const verdict = checkChain(String(payload.tool_input?.command ?? ''));
    if (!verdict) return 0;
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason },
    })}\n`);
    record(dir, (db) => logEvent(db, runOf(db, payload.session_id), 'blocked', payload.agent_type ?? 'main',
      { subcommands: verdict.subcommands, segments: verdict.segments }));
    return 0;
  }

  let context = null;
  record(dir, (db) => {
    if (event === 'session-start') context = sessionStart(db, payload, env);
    else if (event === 'subagent-stop') subagentStop(db, payload);
    else if (event === 'stop') stop(db, payload);
    else if (event === 'session-end') sessionEnd(db, payload);
  });
  if (context) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })}\n`);
  }
  return 0;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// The project the session runs in: Claude Code's project folder, or the session's working directory.
function projectDir(payload, env) {
  for (const dir of [env.CLAUDE_PROJECT_DIR, payload.cwd]) {
    if (dir && existsSync(join(dir, MARKER))) return dir;
  }
  return null;
}

// Runs a write against the project database. A missing database is left to `jerome doctor`; any error becomes
// an `error` event if possible, and nothing else.
function record(dir, write) {
  let db;
  try {
    db = openDb(dir);
    if (!db) return;
    write(db);
  } catch (err) {
    try {
      if (db) logEvent(db, null, 'error', null, { message: String(err.message).slice(0, 200) });
    } catch {
      // Nothing left to do: a hook never fails the session.
    }
  } finally {
    db?.close();
  }
}

function now() {
  return new Date().toISOString();
}

function elapsed() {
  return Math.round(process.uptime() * 1000);
}

function logEvent(db, runId, kind, agent, data = {}) {
  db.prepare('INSERT INTO events (run_id, at, kind, agent, data) VALUES (?, ?, ?, ?, ?)')
    .run(runId, now(), kind, agent, JSON.stringify({ ...data, ms: elapsed() }));
}

function runOf(db, sessionId) {
  if (!sessionId) return null;
  return db.prepare('SELECT id FROM runs WHERE session_id = ?').get(sessionId)?.id ?? null;
}

// The run of a session, created if hooks were installed after it started.
function ensureRun(db, sessionId, kind = 'interactive') {
  db.prepare(`INSERT INTO runs (session_id, kind, started_at) VALUES (?, ?, ?)
    ON CONFLICT (session_id) DO UPDATE SET status = 'running', ended_at = NULL`).run(sessionId, kind, now());
  return runOf(db, sessionId);
}

function sessionStart(db, payload, env) {
  const kind = RUN_KINDS.includes(env.JEROME_RUN_KIND) ? env.JEROME_RUN_KIND : 'interactive';
  const runId = payload.session_id ? ensureRun(db, payload.session_id, kind) : null;
  const pruned = prune(db);
  logEvent(db, runId, 'session-start', 'main', { source: payload.source ?? null, pruned: pruned.usage + pruned.events + pruned.reads });
  // Decision requests opened by heartbeats wait for the user: an interactive session starts by knowing about them (D74).
  // A heartbeat is told what to do by its own prompt.
  if (kind !== 'interactive' || payload.source === 'compact') return null;
  const open = db.prepare("SELECT id, question FROM requests WHERE status = 'open' ORDER BY id").all();
  if (!open.length) return null;
  return `Open decision requests from scheduled runs: ${open.map((r) => `R${r.id} ${r.question}`).join('; ')}. `
    + 'Mention them to the user in your first reply; record each answer with `jerome request answer <id> "<answer>"` (and in decisions.md if it is a decision), or `jerome request drop <id>`.';
}

function subagentStop(db, payload) {
  const runId = payload.session_id ? ensureRunIfMissing(db, payload.session_id) : null;
  let calls = 0;
  if (payload.agent_transcript_path && existsSync(payload.agent_transcript_path)) {
    calls = ingestTranscript(db, {
      path: payload.agent_transcript_path, agent: payload.agent_type ?? 'subagent', agentId: payload.agent_id ?? null, runId,
    }).calls;
  }
  const reply = payload.last_assistant_message || handback(payload.agent_transcript_path);
  logEvent(db, runId, 'subagent-stop', payload.agent_type ?? 'subagent', { calls, ...replyShape(reply) });
}

function stop(db, payload) {
  const runId = payload.session_id ? ensureRunIfMissing(db, payload.session_id) : null;
  const calls = readMain(db, payload, runId);
  logEvent(db, runId, 'stop', 'main', { calls });
}

// Closes a session from outside its hooks: the heartbeat runner calls it after Claude Code exits, since a run it
// stopped at the token cap never reached its SessionEnd hook. Reading is incremental, so nothing counts twice.
export function closeSession(dir, payload) {
  record(dir, (db) => sessionEnd(db, payload));
}

// The last word on a session: whatever the asynchronous hooks did not read, because they were still running when a
// headless session closed or the transcript lacked the final message, is read here.
function sessionEnd(db, payload) {
  const runId = payload.session_id ? ensureRunIfMissing(db, payload.session_id) : null;
  let calls = readMain(db, payload, runId);
  if (payload.transcript_path && payload.session_id) {
    const subagents = join(dirname(payload.transcript_path), payload.session_id, 'subagents');
    if (existsSync(subagents)) {
      for (const file of readdirSync(subagents).filter((f) => f.endsWith('.jsonl'))) {
        const agentId = basename(file, '.jsonl').replace(/^agent-/, '');
        let agent = null;
        try {
          agent = JSON.parse(readFileSync(join(subagents, `agent-${agentId}.meta.json`), 'utf8')).agentType ?? null;
        } catch {
          // Without its meta file, the name SubagentStop recorded for it, or a generic one.
        }
        agent ??= db.prepare('SELECT agent FROM usage WHERE agent_id = ? LIMIT 1').get(agentId)?.agent ?? 'subagent';
        calls += ingestTranscript(db, { path: join(subagents, file), agent, agentId, runId }).calls;
      }
    }
  }
  if (runId) {
    db.prepare("UPDATE runs SET ended_at = ?, status = 'done', reason = ? WHERE id = ?").run(now(), payload.reason ?? null, runId);
  }
  logEvent(db, runId, 'session-end', 'main', { reason: payload.reason ?? null, calls });
}

function ensureRunIfMissing(db, sessionId) {
  return runOf(db, sessionId) ?? ensureRun(db, sessionId);
}

function readMain(db, payload, runId) {
  if (!payload.transcript_path || !existsSync(payload.transcript_path)) return 0;
  return ingestTranscript(db, { path: payload.transcript_path, agent: 'main', runId }).calls;
}

// A subagent running in the background replies through the SubagentHandback tool instead of a final text, so
// last_assistant_message is empty: its reply is the message of the last handback in its transcript. Only the end
// of the transcript is read.
export function handback(path) {
  if (!path || !existsSync(path)) return '';
  const text = readFileSync(path, 'utf8');
  const tail = text.length > 262_144 ? text.slice(-262_144) : text;
  let reply = '';
  for (const line of tail.split('\n')) {
    if (!line.includes('"SubagentHandback"')) continue;
    try {
      for (const c of JSON.parse(line).message?.content ?? []) {
        if (c.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string') reply = c.input.message;
      }
    } catch {
      // A partial line at the start of the tail.
    }
  }
  return reply;
}

// How long a subagent's reply was (D62): words, non-empty lines and nested lists. The text itself is never stored.
export function replyShape(text) {
  const reply = String(text ?? '');
  return {
    words: reply.split(/\s+/).filter(Boolean).length,
    lines: reply.split('\n').filter((l) => l.trim()).length,
    nested: /^[ \t]{2,}(?:[-*+]|\d+[.)])\s/m.test(reply),
  };
}
