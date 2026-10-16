// `jerome heartbeat [dir]`: one scheduled run of the lead agent (D6, D73), started by launchd. It goes through
// cheap checks first and stops at the first that fails, leaving its run in the database with the reason (D13):
// lock, open interactive session, trust, provisional PROJECT.md, clean tree, doctor, global limits, a zero-token
// check for changes, a triage on Haiku, and only then the lead agent, in a new session, within its caps.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { MARKER, readMarker } from './template.js';
import { openDb, dbPath } from './db.js';
import { isTrusted } from './limits.js';
import { isProvisional } from './brief.js';
import { runDoctor } from './doctor.js';
import { recordWindows, WINDOWS } from './account.js';
import { globalLimits, projectStatus, projectOver } from './budget.js';

export { globalLimits };
import { DEFAULT_CAPS, jobLabel } from './schedule.js';
import { openRequest } from './request.js';
import { closeSession } from './hooks.js';
import { findTranscript } from './delegations.js';
import { runClaudeAsync } from './claude.js';
import { startProgress, actionOf } from './progress.js';
import { settingsPath } from './profile.js';
import { serviceFolder, recordResultUsage } from './docs.js';
import { DIGEST } from './digest.js';
import { STATE, isLegacy } from './paths.js';
import { areaPlan } from './areas.js';
import { transcriptMeter } from './meter.js';
import { n } from './state.js';

const INTERACTIVE_HOURS = 12;

function cacheDir(...parts) {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'jerome', ...parts);
}

export async function heartbeat(dirArg, { env = process.env, now = new Date(), maxTokens = null, maxTurns = null } = {}) {
  const dir = resolve(dirArg);
  const log = (line) => console.log(`${new Date().toISOString()} ${basename(dir)} ${line}`);
  if (isLegacy(dir) && !existsSync(join(dir, MARKER))) {
    // A project from before D87: nothing can be recorded until it moves to .jerome/ (D89).
    log('not started: this project uses the layout from before .jerome/; run `jerome update` to move it');
    notify(env, basename(dir), 'Heartbeat not started: run `jerome update` to move the project to .jerome/');
    return 1;
  }
  if (!existsSync(join(dir, MARKER))) {
    log(`not started: ${dir} is not a Jérôme project`);
    return 1;
  }
  if (!existsSync(dbPath(dir))) {
    // A project that moved finds no database at its new path (D93): doctor relinks it, with a person's choice.
    log('not started: the project has no database; run `jerome doctor` (it relinks the database of a project that moved)');
    notify(env, basename(dir), 'Heartbeat not started: run `jerome doctor`');
    return 1;
  }
  const settings = readMarker(dir).heartbeat ?? {};
  // Caps given for this run only (D108) take the place of the project's, which stay as they are.
  const caps = { maxTokens: maxTokens ?? settings.maxTokens ?? DEFAULT_CAPS.maxTokens, maxTurns: maxTurns ?? settings.maxTurns ?? DEFAULT_CAPS.maxTurns };
  const once = (given) => (given !== null ? ' (this run)' : '');
  const run = startRun(dir, now);
  const finish = (status, reason, request) => {
    const opened = endRun(dir, run, status, reason, request);
    log(`${status}: ${reason}${opened ? ` (decision request R${opened})` : ''}`);
    if (opened || status === 'failed') notify(env, basename(dir), opened ? `Decision request R${opened}: ${request.question}` : `Heartbeat failed: ${reason}`);
    return 0;
  };

  const lock = acquireLock(dir);
  if (!lock) return finish('blocked', 'locked: another heartbeat of this project is running');
  try {
    const blocked = await checks(dir, now);
    if (blocked) return finish('blocked', blocked.reason, blocked.request);

    // Limits (D84): a window at or over its limit pauses heartbeats, at zero tokens, until it resets. The user is
    // notified once per pause, not at every heartbeat (D85).
    const limits = globalLimits(now);
    if (limits.over) {
      const w = Object.entries(limits.windows).find(([, x]) => x.level === 'over');
      notifyOnce(dir, env, `global:${w?.[0]}:${w?.[1].resetsAt}`, `Heartbeats paused: ${limits.over}`);
      return finish('blocked', limits.over);
    }
    const db = openDb(dir);
    let project;
    try {
      project = projectOver(projectStatus(dir, db, now));
    } finally {
      db.close();
    }
    if (project) {
      notifyOnce(dir, env, project.key, `Heartbeats paused: ${project.reason}`);
      return finish('blocked', project.reason);
    }
    const note = limits.note ? ` (${limits.note})` : '';

    // Areas (D100): those paused, held up by an open request, or whose pace has not come round are left out here,
    // at zero tokens; the triage chooses among the others.
    const db3 = openDb(dir);
    let plan;
    try {
      plan = areaPlan(dir, db3, now);
    } finally {
      db3.close();
    }
    if (!plan.due.length) return finish('done', `no area due: ${plan.skipped.map((a) => `${a.name} ${a.why}`).join(' · ')}${note}`);

    const fingerprint = projectFingerprint(dir, plan.due.map((a) => a.name));
    const last = readLast(dir);
    if (last?.fingerprint === fingerprint && last.verdict === 'no work') return finish('done', `no changes since the last heartbeat${note}`);

    const triage = await runTriage(dir, run, env, plan);
    if (triage.error) return finish('failed', `triage: ${triage.error}${note}`);
    if (!triage.work) {
      writeLast(dir, { fingerprint, verdict: 'no work', at: now.toISOString() });
      return finish('done', `no work: ${triage.reason ?? 'nothing to do'}${note}`);
    }
    const area = plan.due.find((a) => a.name === triage.area);
    setRunArea(dir, run, area.name);

    const before = openRequests(dir);
    const startBranch = currentBranch(dir);
    const lead = await runLead(dir, run, triage.task, caps, settings.model ?? 'opus', env, plan.implicit ? null : area);
    closeSession(dir, { session_id: run.sessionId, transcript_path: findTranscript(run.sessionId), reason: 'heartbeat' });
    writeLast(dir, { fingerprint: projectFingerprint(dir), verdict: 'work', at: new Date().toISOString() });
    const opened = openRequests(dir).filter((r) => !before.some((b) => b.id === r.id));
    for (const r of opened) notify(env, basename(dir), `Decision request R${r.id}: ${r.question}`);
    // A lead agent stopped halfway may leave the tree on its branch (D112): tidied here, or handed to the user.
    const stopped = lead.capped || lead.subtype === 'error_max_turns' || lead.error;
    const tidy = stopped ? tidyTree(dir, startBranch) : { text: '', request: null };
    if (lead.capped) return finish('stopped', `token cap: ${lead.tokens.toLocaleString('en')} tokens over ${caps.maxTokens.toLocaleString('en')}${capDetail(maxTokens !== null, lead.byAgent)}${tidy.text}${note}`, tidy.request);
    if (lead.subtype === 'error_max_turns') return finish('stopped', `turn cap: ${caps.maxTurns} turns${once(maxTurns)}${tidy.text}${note}`, tidy.request);
    if (lead.error) return finish('failed', `${lead.error}${tidy.text}${note}`, tidy.request);
    return finish('done', `${plan.implicit ? '' : `${area.name}: `}${triage.task}${note}`);
  } finally {
    releaseLock(lock);
  }
}

// One row per heartbeat (D13). Its session id is given to Claude Code, so the hooks of the lead agent's session
// update this same row instead of adding one.
function startRun(dir, now) {
  const db = openDb(dir);
  try {
    const sessionId = randomUUID();
    const id = Number(db.prepare("INSERT INTO runs (session_id, kind, started_at, status) VALUES (?, 'heartbeat', ?, 'running')")
      .run(sessionId, now.toISOString()).lastInsertRowid);
    return { id, sessionId };
  } finally {
    db.close();
  }
}

function currentBranch(dir) {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// After a stopped run (D112): with a clean tree, back to the branch the run started from, naming the branch left
// and deleting it only when it holds no commits of its own; with changes, nothing is touched and the user decides.
function tidyTree(dir, start) {
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const branch = currentBranch(dir);
  const dirty = uncommitted(dir);
  if (dirty?.length || git('status', '--porcelain').stdout.split('\n').some((l) => l.startsWith('??') && !l.includes(DIGEST))) {
    return {
      text: `; uncommitted changes left on ${branch}`,
      request: { question: `A heartbeat stopped halfway on branch ${branch} and left uncommitted changes in ${dir}: keep them (commit on the branch) or discard them? Heartbeats skip until the tree is clean.`, recommendation: 'Look at the changes in a session: commit them on the branch if they are worth keeping.' },
    };
  }
  if (!start || !branch || branch === start) return { text: '', request: null };
  const ahead = Number(git('rev-list', '--count', `${start}..${branch}`).stdout.trim()) || 0;
  if (git('switch', '-q', start).status !== 0) return { text: `; left on branch ${branch}`, request: null };
  if (!ahead) {
    git('branch', '-q', '-D', branch);
    return { text: `; branch ${branch} left, no commits: removed, back on ${start}`, request: null };
  }
  return { text: `; branch ${branch} left, ${ahead} ${ahead === 1 ? 'commit' : 'commits'}: kept, back on ${start}`, request: null };
}

// " (this run; main 58k, developer 110k)": whether the cap was given for this run, and who used the tokens.
function capDetail(once, byAgent) {
  const split = Object.entries(byAgent ?? {}).sort((a, b) => b[1] - a[1]).map(([agent, t]) => `${agent} ${n(t)}`).join(', ');
  const parts = [once ? 'this run' : null, split || null].filter(Boolean);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

function setRunArea(dir, run, area) {
  const db = openDb(dir);
  try {
    db.prepare('UPDATE runs SET area = ? WHERE id = ?').run(area, run.id);
  } finally {
    db.close();
  }
}

function endRun(dir, run, status, reason, request) {
  const db = openDb(dir);
  try {
    db.prepare('UPDATE runs SET status = ?, reason = ?, ended_at = ? WHERE id = ?').run(status, reason, new Date().toISOString(), run.id);
    if (!request) return null;
    // A block that keeps happening opens one request, not one per heartbeat.
    const existing = db.prepare("SELECT id FROM requests WHERE status = 'open' AND question = ?").get(request.question);
    if (existing) return null;
    return openRequest(db, { ...request, runId: run.id });
  } finally {
    db.close();
  }
}

function openRequests(dir) {
  const db = openDb(dir);
  try {
    return db.prepare("SELECT id, question FROM requests WHERE status = 'open'").all();
  } finally {
    db.close();
  }
}

// A lock file with the pid of the heartbeat holding it. A lock left by a process that no longer exists is taken over.
function acquireLock(dir) {
  const path = cacheDir('locks', `${jobLabel(dir)}.lock`);
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' });
      return path;
    } catch {
      const pid = Number(readFileSync(path, 'utf8'));
      if (alive(pid)) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function releaseLock(path) {
  if (path) rmSync(path, { force: true });
}

// The checks that cost nothing, in order. Each failure has a reason and, when the user must act, a decision request.
async function checks(dir, now) {
  const db = openDb(dir);
  try {
    const since = new Date(now.getTime() - INTERACTIVE_HOURS * 3_600_000).toISOString();
    const open = db.prepare("SELECT count(*) n FROM runs WHERE kind = 'interactive' AND status = 'running' AND started_at >= ?").get(since).n;
    if (open) return { reason: 'an interactive session is open in the project' };
  } finally {
    db.close();
  }
  if (isTrusted(dir) !== true) {
    return {
      reason: 'the folder is not trusted in Claude Code, so the project\'s allow rules would be ignored',
      request: { question: `Open \`claude\` in ${dir} once and accept the trust dialog, so heartbeats can run.`, recommendation: 'Do it now; the next heartbeat starts by itself.' },
    };
  }
  const project = join(dir, STATE.project);
  if (existsSync(project) && isProvisional(readFileSync(project, 'utf8'))) {
    return {
      reason: 'PROJECT.md is provisional',
      request: { question: 'PROJECT.md is still provisional: open a session so the lead agent converts brief.md with your confirmation.', recommendation: 'Open a session with `claude`.' },
    };
  }
  const dirty = uncommitted(dir);
  if (dirty === null) return { reason: 'not a git repository with a commit yet' };
  if (dirty.length) {
    return {
      reason: `uncommitted changes (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', …' : ''})`,
      request: { question: `Commit or discard the uncommitted changes in ${dir}: heartbeats start from a clean tree.`, recommendation: 'Commit them, or ask the lead agent to.' },
    };
  }
  const report = await runDoctor(dir, { setup: true, fix: true });
  if (!report.ok) {
    const failed = report.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
    return {
      reason: `jerome doctor failed: ${failed.join('; ')}`,
      request: { question: `Run \`jerome doctor\` in ${dir} and fix what it reports: ${failed.join('; ')}.`, recommendation: 'Fix it; the next heartbeat starts by itself.' },
    };
  }
  return null;
}

// Tracked files changed in the working tree, except digest.md, which the lead agent appends to, and .jerome, which
// `jerome schedule` and `jerome update` change. Null without a commit.
function uncommitted(dir) {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir, stdio: 'ignore' });
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir, encoding: 'utf8' })
      .split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => f !== DIGEST && f !== MARKER);
  } catch {
    return null;
  }
}

// What the triage looks at: when none of it changed since a "no work" verdict, there is nothing new to do.
function projectFingerprint(dir, due = []) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(due));
  try {
    hash.update(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }));
  } catch {
    hash.update('no-head');
  }
  for (const file of [STATE.open, STATE.decisions, STATE.scope, STATE.areas]) {
    hash.update(existsSync(join(dir, file)) ? readFileSync(join(dir, file)) : '');
  }
  const db = openDb(dir);
  try {
    hash.update(JSON.stringify(db.prepare("SELECT count(*) n, max(answered_at) at FROM requests WHERE status != 'open'").get()));
  } finally {
    db.close();
  }
  return hash.digest('hex');
}

function lastPath(dir) {
  return cacheDir('heartbeat', `${jobLabel(dir)}.json`);
}

function readLast(dir) {
  try {
    return JSON.parse(readFileSync(lastPath(dir), 'utf8'));
  } catch {
    return null;
  }
}

function writeLast(dir, data) {
  mkdirSync(dirname(lastPath(dir)), { recursive: true });
  writeFileSync(lastPath(dir), `${JSON.stringify(data)}\n`);
}

// The triage (D73, D100): a service call on Haiku with no tools, given the little it needs in the prompt. It answers
// whether there is one task the lead agent can do now without the user, and in which of the areas due. Its stream
// carries the subscription windows too, recorded like the lead agent's (rate_limit_event).
async function runTriage(dir, run, env, plan) {
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  let gitLog = '';
  try {
    gitLog = execFileSync('git', ['log', '-10', '--oneline'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    // No history yet.
  }
  const db = openDb(dir);
  let requests;
  try {
    requests = db.prepare('SELECT id, question, status, answer, area FROM requests ORDER BY id DESC LIMIT 10').all();
  } finally {
    db.close();
  }
  const digestLines = read(DIGEST).split('\n').filter((l) => l.startsWith('- ')).slice(-3);
  const settings = settingsPath(dir);
  let out;
  const progress = startProgress('triage on Haiku: is there work to do?');
  try {
    out = await runClaudeAsync(['-p', triagePrompt({ plan, open: read(STATE.open), gitLog, requests, digestLines }), '--model', 'haiku', '--tools', '',
      '--no-session-persistence', '--output-format', 'stream-json', '--verbose', ...(existsSync(settings) ? ['--settings', settings] : [])],
    { cwd: serviceFolder(dir), timeout: 180_000, env: { JEROME_HOOKS: 'off' } });
  } catch (err) {
    return { error: err.message };
  } finally {
    progress.stop();
  }
  let result = null;
  for (const line of out.split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'rate_limit_event') recordRateLimit(e.rate_limit_info, 'triage');
    else if (e.type === 'result') result = e;
  }
  if (!result) return { error: 'unreadable result' };
  const db2 = openDb(dir);
  try {
    recordResultUsage(db2, run.id, result, 'triage');
  } finally {
    db2.close();
  }
  const verdict = String(result.result ?? '').match(/\{[\s\S]*\}/);
  let v;
  try {
    v = JSON.parse(verdict?.[0] ?? '');
  } catch {
    return { error: 'the triage did not answer with JSON' };
  }
  const work = v.work === true && Boolean(v.task);
  // With one area the choice is made; with several, an area that is not due is not taken on trust.
  const area = plan.due.length === 1 ? plan.due[0].name : String(v.area ?? '');
  if (work && !plan.due.some((a) => a.name === area)) return { error: `the triage chose ${area ? `the area "${area.slice(0, 40)}", which is not due` : 'no area'}` };
  const task = String(v.task ?? '').slice(0, 300);
  return { work, area, task: v.milestone === true ? `${task} (check the milestone's criteria)` : task, reason: String(v.reason ?? '').slice(0, 300) };
}

export function triagePrompt({ plan, open = '', gitLog = '', requests = [], digestLines = [] }) {
  const areas = plan.due.map((a) => `### ${a.name}${plan.implicit ? '' : ` · priority ${a.priority} · ${a.pace} pace · last heartbeat ${a.lastAt ? a.lastAt.slice(0, 16).replace('T', ' ') : 'never'}`}
Goal: ${a.goal ?? 'none'}${a.milestone ? `\nMilestone: ${a.milestone}` : ''}
${a.milestone ? 'Criteria' : 'Success criteria'}: ${a.criteria ?? 'none'}`).join('\n\n');
  return `You decide whether a scheduled heartbeat of a project should start its lead agent, and on which area of work.
Answer with one JSON object and nothing else: {"work": true|false, "area": "<area name>", "task": "<one task, one sentence>", "milestone": true|false, "reason": "<one sentence>"}.
Areas are listed by priority, highest first. Take the first area with one concrete task that moves it towards its criteria, can be done now without the user, and depends neither on an open decision request nor on an open question of open.md. Prefer the next step the recent history points to. An answered request that changes an area's milestone comes first: the task is to record it. When the history shows an area's criteria all met, set "milestone": true and make checking them the task.

## Areas due now
${areas}

## Open questions and parked topics (open.md)
${open.trim() || 'none'}

## Recent commits
${gitLog || 'none'}

## Decision requests (latest first)
${requests.map((r) => `R${r.id} [${r.status}]${r.area ? ` (${r.area})` : ''} ${r.question}${r.answer ? ` → ${r.answer}` : ''}`).join('\n') || 'none'}

## Latest heartbeats (digest.md)
${digestLines.join('\n') || 'none'}`;
}

export function leadPrompt(task, area = null) {
  const where = area ? `
Area: ${area.name} (folder ${area.folder}; agents ${area.agents.join(', ') || 'none listed'}). Milestone: ${area.milestone} — criteria: ${area.criteria}
- Work in the area's folder, with its agents. If its milestone's criteria are met, open a decision request proposing the next milestone and its criteria (options: open it / continue / area briefing), and stop.` : '';
  return `This is a scheduled heartbeat of this project: nobody reads this session while it runs.
Task chosen by the triage: ${task}${where}
- Do this task only. Work on a new branch. Delegate reading and work to the agents in .claude/agents/, and keep your own turns few.
- Never ask the user. When you need a decision, run \`jerome request open --question "…" --options "…" --recommendation "…"\` and stop that line of work.
- When the tests pass and there are no conflicts, merge the branch into main and report it; if tests fail or there is a conflict, open a decision request instead.
- Before ending, append one line to .jerome/digest.md: \`- YYYY-MM-DD HH:MM · ${area ? `${area.name} · ` : ''}what you did · branches merged · requests opened\`. Commit it with your work, and end on main with a clean working tree.
- End with at most 3 lines.`;
}

// The lead agent in a new session (never resumed: long sessions are where its usage grows), with the turn cap
// passed to Claude Code and the token cap enforced here (D109): from the usage in the stream and, every few seconds,
// from the session's transcripts, subagents included; the larger count decides.
const METER_MS = Number(process.env.JEROME_METER_MS) || 3000;

function runLead(dir, run, task, caps, model, env, area) {
  return new Promise((done) => {
    const child = spawn('claude', ['-p', leadPrompt(task, area), '--model', model, '--max-turns', String(caps.maxTurns),
      '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', '--session-id', run.sessionId], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, JEROME_RUN_KIND: 'heartbeat', JEROME_SESSION_ID: run.sessionId },
    });
    const usage = new Map();
    const state = { tokens: 0, byAgent: {}, capped: false, subtype: null, error: null };
    const meter = transcriptMeter(run.sessionId);
    let streamed = 0;
    let measured = { total: 0, byAgent: {} };
    const check = () => {
      state.tokens = Math.max(streamed, measured.total);
      state.byAgent = measured.total >= streamed ? measured.byAgent : { main: streamed };
      if (state.tokens > caps.maxTokens && !state.capped) {
        state.capped = true;
        child.kill('SIGTERM');
      }
    };
    const timer = setInterval(() => {
      measured = meter.read();
      check();
    }, METER_MS);
    const progress = startProgress(`lead agent: ${task}`);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });
    createInterface({ input: child.stdout }).on('line', (line) => {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      progress.update(actionOf(e) ? `lead agent: ${actionOf(e)} · ${state.tokens.toLocaleString('en')} tokens` : null);
      if (e.type === 'assistant' && e.message?.usage) {
        const u = e.message.usage;
        const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        const key = e.message.id ?? `${usage.size}`;
        usage.set(key, Math.max(usage.get(key) ?? 0, tokens));
        streamed = [...usage.values()].reduce((a, b) => a + b, 0);
        check();
      } else if (e.type === 'rate_limit_event') {
        recordRateLimit(e.rate_limit_info, 'heartbeat');
      } else if (e.type === 'result') {
        state.subtype = e.subtype ?? null;
        if (e.is_error && e.subtype !== 'error_max_turns') state.error = `${e.subtype ?? 'error'}: ${String(e.result ?? '').slice(0, 200)}`;
      }
    });
    child.on('error', (err) => {
      clearInterval(timer);
      progress.stop();
      state.error = err.message;
      done(state);
    });
    child.on('close', (code) => {
      clearInterval(timer);
      progress.stop();
      if (!state.capped && !state.subtype && code !== 0) state.error = `claude exited with code ${code}: ${stderr.trim().split('\n').pop() ?? ''}`;
      done(state);
    });
  });
}

// The subscription windows from a headless run (D20, D52), as fractions in the rate_limit_event.
function recordRateLimit(info, source) {
  const windows = info?.unifiedWindows ?? {};
  const reading = {};
  for (const w of WINDOWS) {
    if (typeof windows[w]?.utilization === 'number') reading[w] = { used: Math.round(windows[w].utilization * 100), resetsAt: windows[w].resetsAt ?? null };
  }
  try {
    if (Object.keys(reading).length) recordWindows(reading, { source });
  } catch {
    // The account file is a convenience: a failure here never stops the run.
  }
}

// A notification for a pause, once per limit and window: the key names both, and the last one sent is kept.
function notifyOnce(dir, env, key, message) {
  const path = cacheDir('notified', `${jobLabel(dir)}.json`);
  let last = null;
  try {
    last = JSON.parse(readFileSync(path, 'utf8')).key;
  } catch {
    // Never notified.
  }
  if (last === key) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ key, at: new Date().toISOString() })}\n`);
  notify(env, basename(dir), message);
}

// A local macOS notification when the user is needed (D74). No external channel. JEROME_NOTIFY_LOG writes the
// notifications to a file instead, for tests.
function notify(env, project, message) {
  if (env.JEROME_NOTIFY_LOG) {
    writeFileSync(env.JEROME_NOTIFY_LOG, `${project}: ${message}\n`, { flag: 'a' });
    return;
  }
  if (env.JEROME_NOTIFY === 'off' || process.platform !== 'darwin') return;
  const quote = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`;
  spawnSync('osascript', ['-e', `display notification ${quote(message)} with title ${quote(`Jérôme · ${project}`)}`], { stdio: 'ignore', timeout: 5000 });
}
