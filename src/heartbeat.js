// `jerome heartbeat [dir]` and `jerome heartbeat run <slot>`: one scheduled run of the lead agent (D6, D73, D118),
// started by launchd. It goes through cheap checks first and stops at the first that fails, leaving its run in the
// database with the reason (D13): lock, trust, provisional PROJECT.md, the repository's start state (D119), doctor,
// limits, a zero-token check for changes, a triage on Haiku, and only then the lead agent, in a new session, within
// its caps and its max duration. Every run of the lead agent ends with a check of the state it left (D120), and
// what goes wrong becomes an alert (D121).
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, fstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { basename, dirname, join, resolve } from 'node:path';
import { MARKER, readMarker } from './template.js';
import { openDb, dbPath } from './db.js';
import { isTrusted } from './limits.js';
import { isProvisional } from './brief.js';
import { runDoctor } from './doctor.js';
import { readAccount, recordWindows, WINDOWS } from './account.js';
import { globalLimits, projectStatus, projectOver } from './budget.js';

export { globalLimits };
import { DEFAULT_CAPS, jobLabel, logPath } from './schedule.js';
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
import { checkPages, saveHashes, watchedPages } from './watch.js';
import { n } from './state.js';
import { heartbeatConfig } from './heartbeatconfig.js';
import { acquireLock, releaseLock, cacheDir, startState, endCheck, digestLines, currentBranch, uncommitted, readResume, writeResume, clearResume, overrideToday } from './runstate.js';
import { raiseAlert, resolveAlerts, sameAsBefore, pushAlert } from './alerts.js';

// An interactive session counts as working alongside a heartbeat when its run is open and started within this many
// hours: older ones are sessions that ended without their SessionEnd hook.
const INTERACTIVE_HOURS = 12;

export async function heartbeat(dirArg, { env = process.env, now = new Date(), maxTokens = null, maxTurns = null, slot: slotName = null } = {}) {
  const dir = resolve(dirArg);
  const log = projectLog(dir);
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
  const { config } = heartbeatConfig(dir);
  // Caps given for this run only (D108) take the place of the project's, which stay as they are.
  const caps = { maxTokens: maxTokens ?? settings.maxTokens ?? DEFAULT_CAPS.maxTokens, maxTurns: maxTurns ?? settings.maxTurns ?? DEFAULT_CAPS.maxTurns, once: maxTokens !== null || maxTurns !== null };
  const given = { tokens: maxTokens !== null, turns: maxTurns !== null };
  // Saved with the run (D115): the live view shows the run's tokens against them, `jerome projects` knows a trial.
  const run = startRun(dir, now, caps, slotName);
  const record = { mode: null, exitCode: null, outcome: null };
  const finish = (status, reason, { request = null, alert = false, alertKey = undefined, notified = false } = {}) => {
    const ended = endRun(dir, run, status, reason, request, record);
    const flags = [record.mode, slotName ? `slot ${slotName}` : null, `${Math.round((Date.now() - now.getTime()) / 60_000)} min`,
      record.exitCode !== null ? `exit ${record.exitCode}` : null, record.outcome ? `end check ${record.outcome.ok ? 'ok' : 'failed'}` : null].filter(Boolean);
    log(`${status} [${flags.join(', ')}]: ${reason}${ended.request ? ` (decision request R${ended.request})` : ''}`);
    if (ended.request) notify(env, basename(dir), `Decision request R${ended.request}: ${request.question}`);
    else if (status === 'failed' && !alert) notify(env, basename(dir), `Heartbeat failed: ${reason}`);
    // No silent skips (D121): a broken state is an alert at once, any other block or failure on its second time.
    const db = openDb(dir);
    try {
      const raise = alert || (['blocked', 'stopped', 'failed'].includes(status) && !/^locked/.test(reason) && sameAsBefore(db, run.id, reason));
      if (raise) {
        const a = raiseAlert(db, { reason, key: alertKey, runId: run.id, count: alert ? 1 : 2 });
        if (a.isNew) {
          log(`alert A${a.id}: ${reason}`);
          // A limit pause has had its one notification already (D85); the alert still goes to the push channel.
          if (!notified) notify(env, basename(dir), `Alert A${a.id}: ${reason}`);
          const failed = pushAlert(config.alerts.command, { project: basename(dir), dir, message: `Jérôme · ${basename(dir)} · A${a.id}: ${reason}`, env });
          if (failed) log(`alert push failed: ${failed}`);
        }
      } else if (status === 'done') resolveAlerts(db);
    } finally {
      db.close();
    }
    return 0;
  };

  if (slotName && !config.slots.some((s) => s.name === slotName)) {
    return finish('blocked', `no slot "${slotName}" in .jerome/project.json: run \`jerome heartbeat install\` again`, { alert: true });
  }
  const slot = config.slots.find((s) => s.name === slotName) ?? null;
  const lock = acquireLock(dir);
  if (!lock) return finish('blocked', 'locked: another heartbeat of this project is running');
  // A run stopped from outside (Ctrl+C on a run by hand, launchd unloading the job) stops its lead agent too.
  const stopper = { stop: null };
  const onSignal = () => stopper.stop?.('interrupted');
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const checked = await checks(dir, config);
    if (checked.reason) return finish('blocked', checked.reason, checked);
    const start = checked.start;
    record.mode = start.mode;

    // Limits (D84, D124): a window at or over its limit pauses heartbeats, at zero tokens, until it resets; the project
    // may set its own thresholds on the windows, and an override lifts all of it for the day. The user is notified
    // once per pause, not at every heartbeat (D85).
    let note = '';
    if (overrideToday(dir, now)) note = ' (quota override for today)';
    else {
      const account = readAccount();
      const quota = { ...(config.quota.fiveHour ? { five_hour: config.quota.fiveHour } : {}), ...(config.quota.sevenDay ? { seven_day: config.quota.sevenDay } : {}) };
      const limits = globalLimits(now, { ...account, limits: { ...account.limits, ...quota } });
      if (limits.over) {
        const w = Object.entries(limits.windows).find(([, x]) => x.level === 'over');
        notifyOnce(dir, env, `global:${w?.[0]}:${w?.[1].resetsAt}`, `Heartbeats paused: ${limits.over}`);
        return finish('blocked', limits.over, { notified: true });
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
        return finish('blocked', project.reason, { notified: true });
      }
      if (limits.note) note = ` (${limits.note})`;
    }

    // RESUME (D119): half-done work is finished or dropped before anything new, with no triage.
    if (start.mode === 'resume') {
      const lead = await leadRun(dir, run, { label: `resume: ${start.why}`, prompt: leadPrompt(null, null, [], { config, slot, resume: start.why }) }, caps, given, settings, env, config, stopper, record);
      return finish(lead.status, `resume: ${start.why} → ${lead.reason}${note}`, { alert: lead.alert, alertKey: lead.alertKey });
    }

    // Areas (D100): those paused, held up by an open request, or whose pace has not come round are left out here,
    // at zero tokens; the triage chooses among the others.
    const db3 = openDb(dir);
    let plan;
    try {
      plan = areaPlan(dir, db3, now);
    } finally {
      db3.close();
    }
    // The pages areas follow (D111), fetched at zero tokens and saved for their agents to read whole; an area with
    // Trigger: watch is due only when one of them changed.
    for (const a of plan.due.filter((x) => watchedPages(dir, x.name).length)) {
      a.watch = await checkPages(dir, a.name, jobLabel(dir));
      if (a.watch.outside.length) note += ` (${a.name}: skipped outside the WebFetch domains: ${a.watch.outside.join(', ')})`;
      if (a.trigger === 'watch' && (a.watch.unreachable || !a.watch.changed)) plan.skipped.push({ name: a.name, why: a.watch.unreachable ? `page unreachable: ${a.watch.unreachable}` : 'pages unchanged' });
    }
    plan.due = plan.due.filter((a) => !plan.skipped.some((s) => s.name === a.name));
    if (!plan.due.length) return finish('done', `no area due: ${plan.skipped.map((a) => `${a.name} ${a.why}`).join(' · ')}${note}`);

    const fingerprint = projectFingerprint(dir, plan.due.map((a) => a.name), slot?.name);
    const last = readLast(dir);
    if (last?.fingerprint === fingerprint && last.verdict === 'no work') return finish('done', `no changes since the last heartbeat${note}`);

    const triage = await runTriage(dir, run, env, plan, slot);
    if (triage.verdict) saveVerdict(dir, run, triage.verdict);
    if (triage.error) return finish('failed', `triage: ${triage.error}${note}`);
    if (!triage.work) {
      writeLast(dir, { fingerprint, verdict: 'no work', at: now.toISOString() });
      return finish('done', `no work: ${triage.reason ?? 'nothing to do'}${note}`);
    }
    const area = plan.due.find((a) => a.name === triage.area);
    setRunArea(dir, run, area.name);

    const prompt = leadPrompt(triage.task, plan.implicit ? null : area, area.requests, { config, slot });
    const lead = await leadRun(dir, run, { label: `lead agent: ${triage.task}`, prompt }, caps, given, settings, env, config, stopper, record);
    writeLast(dir, { fingerprint: projectFingerprint(dir), verdict: 'work', at: new Date().toISOString() });
    // The pages' new hashes count only once the area's heartbeat has done its work (D111).
    if (lead.status === 'done' && area.watch) saveHashes(jobLabel(dir), area.name, area.watch.pending);
    return finish(lead.status, `${lead.status === 'done' ? `${plan.implicit ? '' : `${area.name}: `}${triage.task}` : lead.reason}${note}`, { alert: lead.alert, alertKey: lead.alertKey });
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    releaseLock(lock);
  }
}

// The lead agent's run and what follows it, the same in both modes: the session closed, the requests it opened
// notified, the end check (D120), the RESUME flag set or cleared, and a tree left on a branch tidied (D112).
async function leadRun(dir, run, { label, prompt }, caps, given, settings, env, config, stopper, record) {
  const before = openRequests(dir);
  const digestBefore = digestLines(dir);
  const maxMs = config.maxMinutes * 60_000;
  const lead = await runLead(dir, run, { label, prompt }, caps, settings.model ?? 'opus', env, maxMs, stopper);
  closeSession(dir, { session_id: run.sessionId, transcript_path: findTranscript(run.sessionId), reason: 'heartbeat' });
  const opened = openRequests(dir).filter((r) => !before.some((b) => b.id === r.id));
  for (const r of opened) notify(env, basename(dir), `Decision request R${r.id}: ${r.question}`);

  const check = endCheck(dir, config, { digestBefore, exitCode: lead.exitCode, timedOut: lead.timedOut, stopped: lead.capped || lead.interrupted || lead.subtype === 'error_max_turns', maxMinutes: config.maxMinutes, interactive: interactiveAlongside(dir, run) });
  record.exitCode = lead.exitCode;
  record.outcome = check;
  const failed = check.failures.join('; ');
  let tidy = '';
  if (check.ok) clearResume(dir);
  else {
    writeResume(dir, { since: new Date().toISOString(), runId: run.id, reason: failed, branch: currentBranch(dir) });
    // Back to main when the tree is clean, keeping a branch with commits for the next run, which the flag points to.
    tidy = tidyTree(dir, config.mainBranch);
  }
  const notes = check.notes.length ? ` (${check.notes.join('; ')})` : '';
  // One open alert for a run that ended badly, whatever stopped it, counted again while the next runs do too.
  const result = (status, reason, alert = !check.ok) => ({ status, reason, alert, alertKey: lead.timedOut ? 'max duration' : 'end check' });
  const after = check.ok ? '' : `; end check: ${failed}${tidy}; next run resumes`;
  if (lead.capped) return result('stopped', `token cap: ${lead.tokens.toLocaleString('en')} tokens over ${caps.maxTokens.toLocaleString('en')}${capDetail(given.tokens, lead.byAgent)}${after}`);
  if (lead.subtype === 'error_max_turns') return result('stopped', `turn cap: ${caps.maxTurns} turns${given.turns ? ' (this run)' : ''}${after}`);
  if (lead.timedOut) return result('stopped', `max duration: ${config.maxMinutes} min, process tree stopped${after}`, true);
  if (lead.interrupted) return result('stopped', `interrupted${after}`);
  if (lead.error) return result('failed', `${lead.error}${after}`);
  if (!check.ok) return result('failed', `end check: ${failed}${tidy}; next run resumes`);
  return result('done', `done${notes}`);
}

// Whether an interactive session of the project was open while this heartbeat ran (D122).
function interactiveAlongside(dir, run) {
  const db = openDb(dir);
  try {
    const since = new Date(Date.now() - INTERACTIVE_HOURS * 3_600_000).toISOString();
    const started = db.prepare('SELECT started_at FROM runs WHERE id = ?').get(run.id)?.started_at ?? since;
    return db.prepare("SELECT count(*) n FROM runs WHERE kind = 'interactive' AND started_at >= ? AND (status = 'running' OR ended_at >= ?)").get(since, started).n > 0;
  } finally {
    db.close();
  }
}

// The runner's lines go to the project's log (D118): under launchd, standard output already is that file; run by
// hand, they are written to both.
function projectLog(dir) {
  const file = logPath(jobLabel(dir));
  let toFile = true;
  try {
    const out = fstatSync(1);
    const log = statSync(file);
    toFile = !(out.dev === log.dev && out.ino === log.ino);
  } catch {
    // No log yet: it is created below.
  }
  return (line) => {
    const text = `${new Date().toISOString()} ${basename(dir)} ${line}`;
    console.log(text);
    if (!toFile) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${text}\n`);
    } catch {
      // The log is a convenience: the run is in the database.
    }
  };
}

// One row per heartbeat (D13). Its session id is given to Claude Code, so the hooks of the lead agent's session
// update this same row instead of adding one.
function startRun(dir, now, caps, slot) {
  const db = openDb(dir);
  try {
    const sessionId = randomUUID();
    const id = Number(db.prepare("INSERT INTO runs (session_id, kind, started_at, status, caps, slot) VALUES (?, 'heartbeat', ?, 'running', ?, ?)")
      .run(sessionId, now.toISOString(), JSON.stringify(caps), slot).lastInsertRowid);
    return { id, sessionId };
  } finally {
    db.close();
  }
}

// After a run whose end check failed (D112, D120): with a clean tree, back to main, naming the branch left and
// deleting it only when it holds no commits of its own; with changes, nothing is touched, and the next run resumes
// from there.
function tidyTree(dir, start) {
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const branch = currentBranch(dir);
  const dirty = uncommitted(dir);
  if (dirty?.length || git('status', '--porcelain').stdout.split('\n').some((l) => l.startsWith('??') && !l.includes(DIGEST))) return `; changes left on ${branch}`;
  if (!start || !branch || branch === start) return '';
  const ahead = Number(git('rev-list', '--count', `${start}..${branch}`).stdout.trim()) || 0;
  if (git('switch', '-q', start).status !== 0) return `; left on branch ${branch}`;
  if (!ahead) {
    git('branch', '-q', '-D', branch);
    return `; branch ${branch} left, no commits: removed, back on ${start}`;
  }
  return `; branch ${branch} left, ${ahead} ${ahead === 1 ? 'commit' : 'commits'}: kept, back on ${start}`;
}

// " (this run; main 58k, developer 110k)": whether the cap was given for this run, and who used the tokens.
function capDetail(once, byAgent) {
  const split = Object.entries(byAgent ?? {}).sort((a, b) => b[1] - a[1]).map(([agent, t]) => `${agent} ${n(t)}`).join(', ');
  const parts = [once ? 'this run' : null, split || null].filter(Boolean);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

function saveVerdict(dir, run, verdict) {
  const db = openDb(dir);
  try {
    db.prepare('UPDATE runs SET triage = ? WHERE id = ?').run(JSON.stringify(verdict), run.id);
  } finally {
    db.close();
  }
}

function setRunArea(dir, run, area) {
  const db = openDb(dir);
  try {
    db.prepare('UPDATE runs SET area = ? WHERE id = ?').run(area, run.id);
  } finally {
    db.close();
  }
}

// The run's record (D118): status, reason, end, and how it ran: mode, the lead agent's exit code, the end check.
function endRun(dir, run, status, reason, request, { mode, exitCode, outcome }) {
  const db = openDb(dir);
  try {
    db.prepare('UPDATE runs SET status = ?, reason = ?, ended_at = ?, mode = ?, exit_code = ?, outcome = ? WHERE id = ?')
      .run(status, reason, new Date().toISOString(), mode, exitCode, outcome ? JSON.stringify(outcome) : null, run.id);
    if (!request) return { request: null };
    // A block that keeps happening opens one request, not one per heartbeat.
    const existing = db.prepare("SELECT id FROM requests WHERE status = 'open' AND question = ?").get(request.question);
    if (existing) return { request: null };
    return { request: openRequest(db, { ...request, runId: run.id }) };
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

// The reasons of a blocked heartbeat that only the user can clear, as `checks` and `startState` write them:
// `jerome projects` puts these projects first (D114). A lock and a limit pause clear by themselves.
const NEEDS_YOU = [/^the folder is not trusted/, /^PROJECT\.md is provisional/, /^not a git repository/, /^uncommitted changes/, /^jerome doctor failed/,
  /^on branch .*, neither/, /^detached HEAD/, /^a [a-z-]+ in progress/, /^no slot /];
export const needsYou = (reason) => NEEDS_YOU.some((r) => r.test(String(reason ?? '')));
// A stop by a cap given for that run only (D108): a manual trial, not something to call the user for. Runs keep
// their caps since D115; the reason's text tells it for the runs from before.
export const oneRunCap = (reason) => /^(token|turn) cap: .*\(this run[;)]/.test(String(reason ?? ''));

// The checks that cost nothing, in order. Each failure has a reason and, when the user must act, a decision request
// or an alert; when all pass, the start state they found (D119). An interactive session no longer stops a heartbeat
// (D122): the PreToolUse hook keeps it off the repository while the heartbeat runs.
async function checks(dir, config) {
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
  const start = startState(dir, config);
  if (start.mode === 'skip') return { reason: start.reason, alert: start.alert === true };
  const report = await runDoctor(dir, { setup: true, fix: true });
  if (!report.ok) {
    const failed = report.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
    return {
      reason: `jerome doctor failed: ${failed.join('; ')}`,
      request: { question: `Run \`jerome doctor\` in ${dir} and fix what it reports: ${failed.join('; ')}.`, recommendation: 'Fix it; the next heartbeat starts by itself.' },
    };
  }
  return { reason: null, start };
}

// What the triage looks at: when none of it changed since a "no work" verdict, there is nothing new to do. A slot's
// text counts too, since another slot may ask for other work.
function projectFingerprint(dir, due = [], slot = null) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(due));
  if (slot) hash.update(`slot:${slot}`);
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
async function runTriage(dir, run, env, plan, slot = null) {
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
  const recent = read(DIGEST).split('\n').filter((l) => l.startsWith('- ')).slice(-3);
  const settings = settingsPath(dir);
  let out;
  const progress = startProgress('triage on Haiku: is there work to do?');
  try {
    out = await runClaudeAsync(['-p', triagePrompt({ plan, open: read(STATE.open), gitLog, requests, digestLines: recent, slot }), '--model', 'haiku', '--tools', '',
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
  // The verdict as given, kept with the run (D110), even when it is refused below.
  const kept = { work: v.work === true, area: v.area ?? null, task: v.task ?? null, reason: v.reason ?? null, milestone: v.milestone === true };
  const given = Object.fromEntries(Object.entries(kept).map(([k, x]) => [k, typeof x === 'string' ? x.slice(0, 300) : x]));
  const work = v.work === true && Boolean(v.task);
  // With one area the choice is made; with several, an area that is not due is not taken on trust.
  const area = plan.due.length === 1 ? plan.due[0].name : String(v.area ?? '');
  if (work && !plan.due.some((a) => a.name === area)) return { verdict: given, error: `the triage chose ${area ? `the area "${area.slice(0, 40)}", which is not due` : 'no area'}` };
  const task = String(v.task ?? '').slice(0, 300);
  return { verdict: given, work, area, task: v.milestone === true ? `${task} (check the milestone's criteria)` : task, reason: String(v.reason ?? '').slice(0, 300) };
}

export function triagePrompt({ plan, open = '', gitLog = '', requests = [], digestLines = [], slot = null }) {
  const areas = plan.due.map((a) => `### ${a.name}${plan.implicit ? '' : ` · priority ${a.priority} · ${a.pace} pace · last heartbeat ${a.lastAt ? a.lastAt.slice(0, 16).replace('T', ' ') : 'never'}`}
Goal: ${a.goal ?? 'none'}${a.milestone ? `\nMilestone: ${a.milestone}` : ''}
${a.milestone ? 'Criteria' : 'Success criteria'}: ${a.criteria ?? 'none'}`).join('\n\n');
  return `You decide whether a scheduled heartbeat of a project should start its lead agent, and on which area of work.
Answer with one JSON object and nothing else: {"work": true|false, "area": "<area name>", "task": "<one task, one sentence>", "milestone": true|false, "reason": "<one sentence>"}.
Areas are listed by priority, highest first. Take the first area with one concrete task that moves it towards its criteria, can be done now without the user, and depends neither on an open decision request nor on an open question of open.md. An open request holds up only what depends on it: choose another task of the same area. The assumptions of open.md hold nothing up. Never choose an item marked for an interactive session, nor one under a parked or ideas section. Prefer the next step the recent history points to. An answered request that changes an area's milestone comes first: the task is to record it. When the history shows an area's criteria all met, set "milestone": true and make checking them the task.
${slot?.text ? `\n## This run's slot: ${slot.name}\n${slot.text}\n` : ''}
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

// The lead agent's prompt (D73, D125): project-agnostic, shipped with Jérôme, and the same invariants in both modes.
// In RESUME mode (D119) the task is the half-done work; otherwise the triage's task, in its area. A slot's text and
// the project's own `heartbeat.prompt` are appended.
export function leadPrompt(task, area = null, requests = area?.requests ?? [], { config = null, slot = null, resume = null } = {}) {
  const main = config?.mainBranch ?? 'main';
  const branch = (config?.workBranch ?? 'agent/*').replace('*', '<short-name>');
  const where = area ? `
Area: ${area.name} (folder ${area.folder}; agents ${area.agents.join(', ') || 'none listed'}). Milestone: ${area.milestone} — criteria: ${area.criteria}${area.watch?.files.length ? `
- The pages this area follows are saved whole in ${area.watch.files.join(', ')}: have them read there with Read, not with WebFetch, which returns summaries.` : ''}
- Work in the area's folder, with its agents. If its milestone's criteria are met, open a decision request with \`jerome request open --milestone\` proposing the next milestone and its criteria (options: open it / continue / area briefing), and stop.` : '';
  const asked = requests.length ? `
- Already asked, still open: ${requests.map((r) => `R${r.id} ${r.question}`).join(' · ')}. Do not ask again, nor do what depends on them.` : '';
  const what = resume
    ? `RESUME mode: an earlier run left work half done: ${resume}.
- Finish that work or drop it, and nothing else in this run. Read open.md, decisions.md and \`git log\` first. Finish: commit on its branch, verify, merge into ${main}. Drop: discard it and delete the branch, and note why in open.md. If it needs the user, open a decision request and leave the branch unmerged, back on ${main}.`
    : `Task chosen by the triage: ${task}${where}
- Do this task only. Work on a new branch named ${branch}.`;
  const tests = config?.test ? `\`${config.test}\`` : 'the project\'s tests';
  return `This is a scheduled heartbeat of this project: nobody reads this session while it runs.
${what}${slot?.text ? `\n- This run's slot (${slot.name}): ${slot.text}` : ''}
- Delegate reading and work to the agents in .claude/agents/, in the foreground: wait for every result before going on, never start one in the background, and never end while one is still working. Keep your own turns few.
- Never ask the user, and never push, deploy, publish or send mail. For an important decision (see jerome.md), run \`jerome request open --question "…" --options "…" --recommendation "…"\`, then go on with the parts of the task that do not depend on it. Make minor, reversible choices yourself, as assumptions in open.md.${asked}
- Verify with ${tests}, and with whatever PROJECT.md asks for, such as screenshots of visual changes. When it passes with no conflicts, merge the branch into ${main} and report it; if it fails or there is a conflict, open a decision request instead.
- Run each command that changes the repository on its own, and stage explicit paths: never \`git add -A\`, \`git add .\` or \`git commit -a\`.
- Before ending, append one line to .jerome/digest.md: \`- YYYY-MM-DD HH:MM · ${area ? `${area.name} · ` : ''}what you did · branches merged · requests opened\`, and update open.md. Commit them with your work, and END ON ${main.toUpperCase()} WITH A CLEAN WORKING TREE: the runner checks it, and anything else is an alert for the user.${config?.prompt ? `\n- ${config.prompt}` : ''}
- End with at most 3 lines.`;
}

// The lead agent in a new session (never resumed: long sessions are where its usage grows), with the turn cap
// passed to Claude Code and the token cap enforced here (D109): from the usage in the stream and, every few seconds,
// from the session's transcripts, subagents included; the larger count decides. Claude Code is started in its own
// process group with no ceiling on waiting for background work (D120), and the max duration stops the whole group.
const METER_MS = Number(process.env.JEROME_METER_MS) || 3000;
const KILL_GRACE_MS = 10_000;

function runLead(dir, run, { label, prompt }, caps, model, env, maxMs, stopper) {
  return new Promise((done) => {
    const child = spawn('claude', ['-p', prompt, '--model', model, '--max-turns', String(caps.maxTurns),
      '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', '--session-id', run.sessionId], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...env, JEROME_RUN_KIND: 'heartbeat', JEROME_SESSION_ID: run.sessionId, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' },
    });
    const usage = new Map();
    const state = { tokens: 0, byAgent: {}, capped: false, timedOut: false, interrupted: false, subtype: null, error: null, exitCode: null };
    // The whole tree: Claude Code, its tools' processes and anything they left running.
    const killTree = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Already gone.
      }
    };
    let stopping = false;
    const stop = (why) => {
      if (why) state[why] = true;
      if (stopping) return;
      stopping = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS).unref();
    };
    stopper.stop = stop;
    const deadline = setTimeout(() => stop('timedOut'), maxMs);
    const meter = transcriptMeter(run.sessionId);
    let streamed = 0;
    let measured = { total: 0, byAgent: {} };
    const check = () => {
      state.tokens = Math.max(streamed, measured.total);
      state.byAgent = measured.total >= streamed ? measured.byAgent : { main: streamed };
      if (state.tokens > caps.maxTokens && !state.capped) stop('capped');
    };
    const timer = setInterval(() => {
      measured = meter.read();
      check();
    }, METER_MS);
    const progress = startProgress(label);
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
    // Whatever Claude Code leaves running when it exits is stopped too, which also closes the pipes it holds.
    child.on('exit', (code) => {
      state.exitCode = code;
      killTree('SIGTERM');
    });
    const end = () => {
      clearInterval(timer);
      clearTimeout(deadline);
      stopper.stop = null;
      progress.stop();
      done(state);
    };
    child.on('error', (err) => {
      state.error = err.message;
      end();
    });
    child.on('close', (code) => {
      state.exitCode ??= code;
      if (!stopping && !state.subtype && code !== 0) state.error = `claude exited with code ${code}: ${stderr.trim().split('\n').pop() ?? ''}`;
      end();
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
