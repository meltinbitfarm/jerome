// `jerome hook <event>`: what Claude Code's hooks run (D59). They write runs, usage and events to the project
// database and never make a session fail: every error ends in exit code 0, recorded as an `error` event when the
// database can be reached. Each event records how long the hook took, from process start (`ms`).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { MARKER } from './template.js';
import { openDb, prune } from './db.js';
import { ingestTranscript } from './usage.js';
import { checkChain, checkStaging, splitCommand, changingGit } from './chain.js';
import { blacklisted } from './blacklist.js';
import { projectStatus, projectSummary, globalLimits } from './budget.js';
import { readAssumptions } from './assumptions.js';
import { lockHolder } from './runstate.js';
import { openAlerts, alertsContext, lostRuns } from './alerts.js';
import { claudePid, processStart, sweepLostRuns } from './lostruns.js';
import { openNotes, notesBlock, NOTES_RULE } from './notes.js';

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
    const command = String(payload.tool_input?.command ?? '');
    const heartbeat = env.JEROME_RUN_KIND === 'heartbeat';
    let verdict;
    try {
      verdict = checkChain(command) ?? checkStaging(command) ?? besideHeartbeat(dir, command, env)
        ?? (heartbeat ? blacklisted(command, { dir, cwd: payload.cwd || dir }) : null);
    } catch (err) {
      // A heartbeat may run any command but the blacklist (D159): when the check itself fails, the command is refused.
      verdict = heartbeat ? { reason: `Refused in a heartbeat: Jérôme could not check this command (${err.message}). Run it another way.` } : null;
    }
    if (!verdict) return 0;
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason },
    })}\n`);
    record(dir, (db) => logEvent(db, runOf(db, payload.session_id), 'blocked', payload.agent_type ?? 'main',
      { subcommands: verdict.subcommands, segments: verdict.segments, ...(verdict.heartbeat ? { heartbeat: verdict.heartbeat } : {}) }));
    return 0;
  }

  let start = null;
  record(dir, (db) => {
    if (event === 'session-start') start = sessionStart(db, payload, env, dir);
    else if (event === 'subagent-stop') subagentStop(db, payload);
    else if (event === 'stop') stop(db, payload);
    else if (event === 'session-end') sessionEnd(db, payload);
  });
  if (start?.context || start?.message) {
    process.stdout.write(`${JSON.stringify({
      ...(start.message ? { systemMessage: start.message } : {}),
      ...(start.context ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: start.context } } : {}),
    })}\n`);
  }
  return 0;
}

// While a heartbeat holds the project's lock (D122), a session in the same working tree must not change the
// repository under it: git commands that would are refused, except creating a separate worktree to work in.
// Reading, and editing files, stay allowed. The heartbeat's own session is never refused.
function besideHeartbeat(dir, command, env) {
  if (RUN_KINDS.includes(env.JEROME_RUN_KIND)) return null;
  const segments = splitCommand(command);
  const changing = segments.filter((s) => changingGit(s) && !(changingGit(s) === 'worktree' && /\bworktree\s+add\b/.test(s))).map(changingGit);
  if (!changing.length) return null;
  const pid = lockHolder(dir);
  if (!pid) return null;
  return {
    reason: `A heartbeat of this project is running in this working tree (pid ${pid}), so git commands that change the repository are refused here until it ends (Jérôme D122): \`jerome heartbeat status\` shows it. Reading and editing files is fine, but commit nothing meanwhile. To work on the repository now, use a separate worktree: \`git worktree add ../<folder> -b <branch>\`, and a session there.`,
    subcommands: changing,
    segments: segments.length,
    heartbeat: pid,
  };
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

function sessionStart(db, payload, env, dir) {
  const kind = RUN_KINDS.includes(env.JEROME_RUN_KIND) ? env.JEROME_RUN_KIND : 'interactive';
  const runId = payload.session_id ? ensureRun(db, payload.session_id, kind) : null;
  // An interactive session's Claude Code process, so the run can be closed if it ends without SessionEnd (D136); and
  // the runs other sessions or heartbeats left that way are closed now. A heartbeat's runner records its own.
  if (runId && kind === 'interactive' && payload.source !== 'compact') {
    const pid = env.JEROME_CLAUDE_PID ? Number(env.JEROME_CLAUDE_PID) : claudePid();
    if (pid) db.prepare('UPDATE runs SET pid = ?, pid_started = ? WHERE id = ?').run(pid, processStart(pid), runId);
    sweepLostRuns(dir);
  }
  const pruned = prune(db);
  logEvent(db, runId, 'session-start', 'main', { source: payload.source ?? null, pruned: pruned.usage + pruned.events + pruned.reads });
  // Decision requests opened by heartbeats wait for the user: an interactive session starts by knowing about them (D74).
  // A heartbeat is told what to do by its own prompt.
  if (kind !== 'interactive' || payload.source === 'compact') return null;
  const open = db.prepare("SELECT id, question, options, recommendation FROM requests WHERE status = 'open' ORDER BY id").all();
  // The assumptions waiting for the user (D116) come with them, so both are put in one block. Alerts about the
  // autonomous runs (D121) come before everything, for the lead agent and, in a line of their own, for the user.
  const assumptions = readAssumptions(dir);
  const alerts = openAlerts(db);
  // Notes the user sent from Telegram (D133), as quoted data, after the requests.
  const notes = openNotes(db);
  const context = [alerts.length ? alertsContext(alerts) : null, open.length ? requestsContext(projectDir(payload, env), open) : null, notes.length ? `${NOTES_RULE} Tell the user about them in your first reply.\n${notesBlock(notes)}` : null, assumptions.length ? assumptionsContext(assumptions) : null].filter(Boolean).join('\n\n');
  const alertLine = alerts.length ? `Jérôme: ${alerts.length} heartbeat ${alerts.length === 1 ? 'alert' : 'alerts'}: ${alerts.map((a) => `A${a.id} ${a.reason} (${lostRuns(a)})`).join(' · ')}` : null;
  const message = [alertLine, limitsWarning(db, dir)].filter(Boolean).join('\n');
  return { context: context || null, message: message || null };
}

// A warning for the user, not the model, when a limit is at 90% or more (D84): interactive sessions are never
// blocked, but should not run into a limit unawares. Shown with systemMessage, which costs the model nothing.
function limitsWarning(db, dir) {
  const parts = [];
  try {
    const status = projectStatus(dir, db);
    if (['daily', 'weekly'].some((n) => ['high', 'over'].includes(status[n].level))) parts.push(`project ${projectSummary(status)} API`);
    const g = globalLimits();
    for (const [name, w] of Object.entries(g.windows)) {
      if (['high', 'over'].includes(w.level)) parts.push(`${name === 'five_hour' ? '5h' : '7d'} window ${w.used}% / ${w.limit}%`);
    }
  } catch {
    return null;
  }
  if (!parts.length) return null;
  return `Jérôme: usage near or over its limits: ${parts.join('; ')}. Heartbeats pause at a limit; this session is not blocked.`;
}

// The assumptions of open.md (D116), in full: each is one line.
export function assumptionsContext(assumptions) {
  return ['Assumptions waiting for the user, in open.md `## Assumptions`. In your first reply put them to the user in one block, after any requests: record each confirmed one as a D-entry, each corrected one as a D-entry with the correction and change the work to match, and remove both from open.md.', '',
    ...assumptions.map((a) => `${a.id}: ${a.text}`)].join('\n');
}

// The full open requests (D78): question, options, recommendation, and the project files they cite, so the lead
// agent can put them to the user without exploring. Cited files are included up to a size cap; a larger one is
// named with its size, to read only if needed.
export const CITED_FILE_CHARS = 6000;
export const CITED_TOTAL_CHARS = 12000;

export function requestsContext(dir, open) {
  const parts = ['Open decision requests from scheduled runs. Put them to the user in your first reply, from what follows, without reading other files; record each answer with `jerome request answer <id> "<answer>"` (and in decisions.md if it is a decision), or `jerome request drop <id>`.'];
  const cited = new Map();
  for (const r of open) {
    parts.push(`\nR${r.id}: ${r.question}${r.options ? `\nOptions: ${r.options}` : ''}${r.recommendation ? `\nRecommendation: ${r.recommendation}` : ''}`);
    for (const file of citedFiles(dir, [r.question, r.options, r.recommendation].join(' '))) cited.set(file, true);
  }
  let budget = CITED_TOTAL_CHARS;
  for (const file of cited.keys()) {
    const text = readFileSync(join(dir, file), 'utf8');
    if (text.length > CITED_FILE_CHARS || text.length > budget) {
      parts.push(`\n${file} (${text.length} characters, not included: read it only if the user needs it)`);
      continue;
    }
    budget -= text.length;
    parts.push(`\n--- ${file} ---\n${text.trim()}\n--- end of ${file} ---`);
  }
  return parts.join('\n');
}

// Project files named in a text, such as notes/hook-rigid-fields.md: relative paths that exist inside the project.
function citedFiles(dir, text) {
  if (!dir) return [];
  const found = [];
  for (const m of String(text).matchAll(/(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s`'"),;:.!?])/g)) {
    const file = m[1].replace(/^\.\//, '');
    if (file.startsWith('..') || file.startsWith('/') || found.includes(file)) continue;
    const path = join(dir, file);
    try {
      if (existsSync(path) && statSync(path).isFile()) found.push(file);
    } catch {
      // Not a file of the project.
    }
  }
  return found;
}

function subagentStop(db, payload) {
  const runId = payload.session_id ? ensureRunIfMissing(db, payload.session_id) : null;
  // Claude Code's own helpers, such as the one that titles a session, stop as subagents with no type and no
  // transcript. They are not delegations: their stop is recorded, but not as a reply length (D78).
  if (!payload.agent_type) {
    logEvent(db, runId, 'subagent-stop', null, { internal: true });
    return;
  }
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
