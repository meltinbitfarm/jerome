// Tests of phase 8: scheduling, the heartbeat's checks and caps, decision requests and the digest, with a fake
// `claude` and a fake `launchctl` on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sandbox, sandboxDb } from './sandbox.js';
import { globalLimits, leadPrompt } from '../src/heartbeat.js';

// A project ready for heartbeats: created, committed, and trusted in Claude Code.
function project(env = {}) {
  const box = sandbox({ env });
  assert.equal(box.run('new', 'demo').status, 0);
  const dir = realpathSync(join(box.root, 'demo'));
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'ignore' });
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const trust = (value) => writeFileSync(join(box.root, 'claude-config', '.claude.json'), JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: value } } }));
  trust(true);
  const db = () => new DatabaseSync(sandboxDb(box.root, dir), { readOnly: true });
  const lastRun = () => {
    const d = db();
    const r = d.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get();
    d.close();
    return r;
  };
  const requests = () => {
    const d = db();
    const r = d.prepare("SELECT id, run_id, question FROM requests WHERE status = 'open'").all();
    d.close();
    return r;
  };
  const calls = () => (existsSync(join(box.root, 'claude-calls.log')) ? readFileSync(join(box.root, 'claude-calls.log'), 'utf8') : '');
  const account = (data) => {
    mkdirSync(join(box.root, '.config', 'jerome'), { recursive: true });
    writeFileSync(join(box.root, '.config', 'jerome', 'account.json'), JSON.stringify({ schema: 'jerome.account/v1', ...data }));
  };
  return { ...box, dir, git, trust, db, lastRun, requests, calls, account };
}

test('an untrusted project is skipped with one decision request, not one per heartbeat', () => {
  const p = project();
  p.trust(false);
  assert.equal(p.run('heartbeat', 'demo').status, 0);
  const run = p.lastRun();
  assert.equal(run.kind, 'heartbeat');
  assert.equal(run.status, 'blocked');
  assert.match(run.reason, /not trusted/);
  assert.equal(p.requests().length, 1);
  assert.equal(p.requests()[0].run_id, run.id);
  p.run('heartbeat', 'demo');
  assert.equal(p.requests().length, 1);
  assert.doesNotMatch(p.calls(), /--max-turns|--model haiku/);
});

test('uncommitted changes, a provisional PROJECT.md and an open interactive session skip the heartbeat', () => {
  const p = project();
  writeFileSync(join(p.dir, '.claude', 'rules', 'jerome.md'), 'changed\n');
  p.run('heartbeat', 'demo');
  assert.match(p.lastRun().reason, /uncommitted changes \(\.claude\/rules\/jerome\.md\)/);
  p.git('checkout', '--', '.claude/rules/jerome.md');

  // digest.md is the lead agent's to append to: it never counts as uncommitted.
  writeFileSync(join(p.dir, '.jerome', 'digest.md'), '- 2026-10-15 09:00 · did x\n');
  p.git('add', '.jerome/digest.md');
  p.git('commit', '-q', '-m', 'digest');
  writeFileSync(join(p.dir, '.jerome', 'digest.md'), '- 2026-10-15 09:00 · did x\n- 2026-10-15 10:00 · did y\n');
  // Nor does .jerome, which `jerome schedule` changes.
  writeFileSync(join(p.dir, '.jerome', 'project.json'), readFileSync(join(p.dir, '.jerome', 'project.json'), 'utf8').replace('"files"', '"heartbeat": {},\n  "files"'));

  writeFileSync(join(p.dir, '.jerome', 'PROJECT.md'), '<!-- jerome:provisional -->\n# Provisional\n');
  p.git('add', '.jerome/PROJECT.md');
  p.git('commit', '-q', '-m', 'provisional');
  p.run('heartbeat', 'demo');
  assert.match(p.lastRun().reason, /PROJECT\.md is provisional/);
  p.git('rm', '-q', '.jerome/PROJECT.md');
  p.git('commit', '-q', '-m', 'drop');

  p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, JSON.stringify({ cwd: p.dir, session_id: 'live' }), 'hook', 'session-start');
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'blocked');
  assert.match(p.lastRun().reason, /interactive session is open/);
});

test('a second heartbeat stops on the lock, and a lock left by a dead process is taken over', () => {
  const p = project();
  const label = execFileSync(process.execPath, ['-e', `import('${new URL('../src/schedule.js', import.meta.url)}').then(m => console.log(m.jobLabel(${JSON.stringify(p.dir)})))`], { encoding: 'utf8' }).trim();
  const lock = join(p.root, '.cache', 'jerome', 'locks', `${label}.lock`);
  mkdirSync(join(p.root, '.cache', 'jerome', 'locks'), { recursive: true });
  writeFileSync(lock, String(process.pid));
  p.run('heartbeat', 'demo');
  assert.match(p.lastRun().reason, /^locked/);
  assert.equal(p.requests().length, 0);
  writeFileSync(lock, '999999');
  p.run('heartbeat', 'demo');
  assert.doesNotMatch(p.lastRun().reason, /locked/);
  assert.ok(!existsSync(lock), 'the lock is released at the end');
});

test('a window over its global limit skips the heartbeat at no cost, and an old reading is mentioned', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const future = Date.parse('2026-10-20T00:00:00Z') / 1000;
  const reading = (used, readAt) => ({ windows: { seven_day: { used, resetsAt: future, readAt, source: 'statusline' } }, limits: { seven_day: 70 } });
  assert.equal(globalLimits(now, reading(72, '2026-10-15T11:30:00Z')).over, 'global limit: 7d 72% ≥ 70%');
  assert.equal(globalLimits(now, reading(72, '2026-10-15T06:00:00Z')).over, 'global limit: 7d 72% ≥ 70% (reading from 6 h ago)');
  assert.deepEqual([globalLimits(now, reading(40, '2026-10-15T06:00:00Z')).over, globalLimits(now, reading(40, '2026-10-15T06:00:00Z')).note], [null, 'limits checked on a reading from 6 h ago']);
  // A reading whose window has reset since says nothing about now.
  assert.equal(globalLimits(now, { windows: { seven_day: { used: 99, resetsAt: 1, readAt: '2026-10-01T00:00:00Z' } }, limits: { seven_day: 70 } }).over, null);

  const p = project();
  p.account({ windows: { seven_day: { used: 72, resetsAt: Math.floor(Date.now() / 1000) + 86_400, readAt: new Date().toISOString(), source: 'statusline' } }, limits: { seven_day: 70 } });
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().reason, 'global limit: 7d 72% ≥ 70%');
  assert.doesNotMatch(p.calls(), /--model haiku/);
});

test('the triage decides there is no work, and the next heartbeat with nothing changed costs nothing', () => {
  const p = project({ FAKE_TRIAGE: '{"work": false, "reason": "waiting for R1"}' });
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'done');
  assert.equal(p.lastRun().reason, 'no work: waiting for R1');
  const d = p.db();
  assert.deepEqual({ ...d.prepare("SELECT agent, model, input FROM usage WHERE agent = 'triage'").get() }, { agent: 'triage', model: 'claude-haiku-5-5', input: 3000 });
  d.close();
  const before = p.calls().split('\n').filter((l) => l.includes('--model')).length;
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().reason, 'no changes since the last heartbeat');
  // Only doctor's /context ran, which uses no tokens: no triage, no lead agent.
  assert.equal(p.calls().split('\n').filter((l) => l.includes('--model')).length, before);
});

test('with work to do, the lead agent runs in a new session within its caps, and its usage and windows are recorded', () => {
  const p = project({ FAKE_TRIAGE: '{"work": true, "task": "Write the report writer", "reason": "next step"}' });
  p.run('heartbeat', 'demo');
  const run = p.lastRun();
  assert.equal(run.status, 'done');
  assert.equal(run.reason, 'Write the report writer');
  // Its caps are kept with it (D115), for the live view.
  assert.deepEqual(JSON.parse(run.caps), { maxTokens: 500000, maxTurns: 40, once: false });
  const lead = p.calls().split('\n').find((l) => l.includes('--max-turns'));
  assert.match(lead, /--model opus --max-turns 40 --permission-mode acceptEdits --output-format stream-json --verbose --session-id /);
  assert.ok(lead.includes(run.session_id));
  assert.doesNotMatch(lead, /--resume|--continue/);
  const d = p.db();
  assert.equal(d.prepare("SELECT count(*) n FROM usage WHERE run_id = ? AND agent = 'main'").get(run.id).n, 2);
  d.close();
  const account = JSON.parse(readFileSync(join(p.root, '.config', 'jerome', 'account.json'), 'utf8'));
  assert.deepEqual([account.windows.five_hour.used, account.windows.five_hour.source], [42, 'heartbeat']);
  assert.match(leadPrompt('x'), /Never ask the user[\s\S]*jerome request open[\s\S]*merge the branch into main[\s\S]*digest\.md/);
});

test('the token cap stops the lead agent, and so does the turn cap', () => {
  const p = project({ FAKE_TRIAGE: '{"work": true, "task": "Big task"}', FAKE_LEAD_CALLS: '40', FAKE_LEAD_TOKENS: '100000', FAKE_LEAD_SLEEP: '0.05' });
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'stopped');
  assert.match(p.lastRun().reason, /^token cap: [\d,]+ tokens over 500,000/);

  const q = project({ FAKE_TRIAGE: '{"work": true, "task": "Long task"}', FAKE_LEAD_RESULT: 'error_max_turns' });
  q.run('heartbeat', 'demo');
  assert.equal(q.lastRun().status, 'stopped');
  assert.equal(q.lastRun().reason, 'turn cap: 40 turns');
});

test('a decision request opened by the lead agent is linked to its run, and answered in a session', () => {
  const p = project({ FAKE_TRIAGE: '{"work": true, "task": "Merge task/x"}', FAKE_LEAD_REQUEST: 'Tests fail on task/x: merge anyway?' });
  p.run('heartbeat', 'demo');
  const [req] = p.requests();
  assert.equal(req.question, 'Tests fail on task/x: merge anyway?');
  assert.equal(req.run_id, p.lastRun().id);

  // An interactive session starts by knowing about it.
  const start = p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, JSON.stringify({ cwd: p.dir, session_id: 'later', source: 'startup' }), 'hook', 'session-start');
  assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /R1: Tests fail on task\/x/);
  assert.match(p.run('state', 'demo').stdout, /jerome request answer <id>/);

  // The lead agent runs it from the project folder.
  const inProject = (...args) => spawnSync(process.execPath, [new URL('../bin/jerome.js', import.meta.url).pathname, ...args], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, XDG_DATA_HOME: join(p.root, '.local', 'share') } });
  assert.equal(inProject('request', 'answer', 'R1', 'No,', 'fix', 'the', 'tests', 'first').status, 0);
  assert.equal(p.requests().length, 0);
  assert.equal(inProject('request', 'answer', '1', 'again').status, 1);
  assert.equal(inProject('request', 'drop', '7').status, 1);
  assert.equal(inProject('request', 'open').status, 2);
});

test('jerome digest puts the lead agent\'s lines and the figures together at no token cost', () => {
  const p = project();
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(p.dir, '.jerome', 'digest.md'), `# Digest\n\n- 2020-01-01 09:00 · old work\n- ${today} 09:00 · wrote the parser · task/parser merged · none\n`);
  const before = p.calls();
  const r = p.run('digest', 'demo', '--since', '7d');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^demo · digest of the last 7 days$/m);
  assert.match(r.stdout, /wrote the parser/);
  assert.doesNotMatch(r.stdout, /old work/);
  assert.match(r.stdout, /^main      \d+ commits?$/m);
  assert.equal(p.calls(), before, 'no call to Claude Code');
});

test('jerome schedule writes a launchd job with absolute paths, keeps them out of .jerome, and doctor checks it', () => {
  const p = project();
  const r = p.run('schedule', 'demo', 'daily', '--at', '07:30');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /every day at 07:30, on opus, at most 500,000 tokens and 40 turns per run/);
  const marker = JSON.parse(readFileSync(join(p.dir, '.jerome', 'project.json'), 'utf8'));
  assert.deepEqual(marker.heartbeat, { every: 'daily', hour: 7, minute: 30, maxTokens: 500000, maxTurns: 40 });
  const plists = execFileSync('ls', [join(p.root, 'Library', 'LaunchAgents')], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(plists.length, 1);
  const plist = readFileSync(join(p.root, 'Library', 'LaunchAgents', plists[0]), 'utf8');
  assert.match(plist, new RegExp(`<string>${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string>`));
  assert.match(plist, /<string>heartbeat<\/string>/);
  assert.match(plist, /<key>Hour<\/key><integer>7<\/integer>/);
  assert.match(readFileSync(join(p.root, 'launchctl.log'), 'utf8'), /^bootstrap gui\/\d+ /m);

  assert.match(p.run('doctor', 'demo').stdout, /✓ Heartbeat job — scheduled and loaded/);
  const broken = p.runWith({ FAKE_LAUNCHCTL_PRINT: 'fail' }, 'doctor', 'demo');
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /✗ Heartbeat job — the job \S+ is not loaded in launchd: reschedule with `jerome schedule \S+ daily --at 07:30 --max-tokens 500000 --max-turns 40`/);

  // The heartbeats' model (D106): set with --model, kept by a new schedule without it, removed with default.
  const path = join(p.dir, '.jerome', 'project.json');
  assert.match(p.run('schedule', 'demo', 'daily', '--at', '07:30', '--model', 'sonnet').stdout, /every day at 07:30, on sonnet,/);
  assert.equal(p.run('schedule', 'demo', 'daily', '--at', '07:30').status, 0);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).heartbeat.model, 'sonnet');
  assert.match(p.runWith({ FAKE_LAUNCHCTL_PRINT: 'fail' }, 'doctor', 'demo').stdout, /--max-turns 40 --model sonnet`/);
  assert.equal(p.run('schedule', 'demo', 'daily', '--model', 'gpt-5').status, 2);
  assert.equal(p.run('schedule', 'demo', 'daily', '--at', '07:30', '--model', 'default').status, 0);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).heartbeat.model, undefined);

  assert.match(p.run('schedule', '--list').stdout, /every day at 07:30/);
  assert.equal(p.run('schedule', 'demo', '--off').status, 0);
  assert.equal(JSON.parse(readFileSync(join(p.dir, '.jerome', 'project.json'), 'utf8')).heartbeat, undefined);
  assert.equal(p.run('schedule', 'demo', 'monthly').status, 2);
  assert.equal(p.run('schedule', 'demo', 'hourly', '--at', '75').status, 2);
});

test('calendar windows start at local midnight and on Monday, and a project limit stops counting when they reset', async () => {
  const { calendarWindows, projectStatus, projectOver } = await import('../src/budget.js');
  const sunday = new Date(2026, 9, 18, 23, 30);
  const w = calendarWindows(sunday);
  assert.equal(w.daily.from.getTime(), new Date(2026, 9, 18).getTime());
  assert.equal(w.daily.resetsAt.getTime(), new Date(2026, 9, 19).getTime());
  assert.equal(w.weekly.from.getTime(), new Date(2026, 9, 12).getTime(), 'the week of a Sunday started on Monday the 12th');
  assert.equal(w.weekly.resetsAt.getTime(), new Date(2026, 9, 19).getTime());

  const p = project();
  writeFileSync(join(p.dir, '.jerome', 'project.json'), readFileSync(join(p.dir, '.jerome', 'project.json'), 'utf8').replace('"files"', '"limits": { "daily": 0.01, "weekly": null },\n  "files"'));
  const d = new DatabaseSync(sandboxDb(p.root, p.dir));
  d.prepare("INSERT INTO usage (request_id, agent, model, input, output, cache_read, at) VALUES ('r1', 'main', 'claude-opus-5-5', 1000, 1000, 10000, ?)").run(new Date(2026, 9, 18, 10).toISOString());
  const over = projectOver(projectStatus(p.dir, d, sunday));
  assert.match(over.reason, /^project limit: today ≈\$0\.03 \/ \$0\.01 API \(12k tokens\), resets at midnight$/);
  // Past midnight the day starts again, and the weekly limit is off: nothing stops the heartbeats.
  assert.equal(projectOver(projectStatus(p.dir, d, new Date(2026, 9, 19, 0, 5))), null);
  d.close();
});

test('a project over its limit pauses heartbeats with one notification, and they start again under the limit', () => {
  const p = project({ JEROME_NOTIFY: '', FAKE_TRIAGE: '{"work": false, "reason": "nothing"}' });
  const log = join(p.root, 'notifications.log');
  const d = new DatabaseSync(sandboxDb(p.root, p.dir));
  d.prepare("INSERT INTO usage (request_id, agent, model, input, output, cache_read, at) VALUES ('r1', 'main', 'claude-opus-5-5', 1000, 1000, 10000, ?)").run(new Date().toISOString());
  d.close();
  assert.equal(p.run('limits', 'demo', '--daily', '0.01').status, 0);
  for (let i = 0; i < 3; i += 1) p.runWith({ JEROME_NOTIFY_LOG: log }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'blocked');
  assert.match(p.lastRun().reason, /^project limit: today ≈\$0\.03 \/ \$0\.01 API/);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1, 'one notification for the pause');
  assert.match(p.run('state', 'demo').stdout, /^paused  heartbeats: project limit: today/m);

  // An interactive session is not blocked, but the user is warned at its start.
  const start = p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, JSON.stringify({ cwd: p.dir, session_id: 'warned', source: 'startup' }), 'hook', 'session-start');
  assert.match(JSON.parse(start.stdout).systemMessage, /usage near or over its limits: project today ≈\$0\.03\/\$0\.01/);
  p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, JSON.stringify({ cwd: p.dir, session_id: 'warned', reason: 'other' }), 'hook', 'session-end');

  assert.equal(p.run('limits', 'demo', '--daily', 'off').status, 0);
  p.runWith({ JEROME_NOTIFY_LOG: log }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'done');
  assert.doesNotMatch(p.run('state', 'demo').stdout, /^paused/m);
});

test('jerome limits sets global limits in account.json and project limits in .jerome, and shows them', () => {
  const p = project();
  const r = p.run('limits', 'demo', '--five-hour', '70', '--seven-day', '75', '--weekly', '30');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Limits set: global 5h 70%, global 7d 75%, project weekly \$30/);
  assert.match(r.stdout, /^project week  .* \/ \$30$/m);
  assert.match(r.stdout, /^project today .* \/ \$5$/m);
  const account = JSON.parse(readFileSync(join(p.root, '.config', 'jerome', 'account.json'), 'utf8'));
  assert.deepEqual(account.limits, { five_hour: 70, seven_day: 75 });
  assert.deepEqual(JSON.parse(readFileSync(join(p.dir, '.jerome', 'project.json'), 'utf8')).limits, { weekly: 30 });
  assert.equal(p.run('limits', 'demo', '--weekly', 'default').status, 0);
  assert.equal(JSON.parse(readFileSync(join(p.dir, '.jerome', 'project.json'), 'utf8')).limits, undefined);
  assert.equal(p.run('limits', 'demo', '--weekly', '30').status, 0);
  assert.equal(p.run('limits', 'demo', '--five-hour', '170').status, 2);
  assert.equal(p.run('limits', 'demo', '--daily', '-1').status, 2);
  writeFileSync(join(p.dir, '.jerome', 'project.json'), readFileSync(join(p.dir, '.jerome', 'project.json'), 'utf8').replace('"weekly": 30', '"weekly": "lots"'));
  assert.ok(JSON.parse(p.run('doctor', 'demo', '--check', '--json').stdout).warnings.some((w) => w.id === 'limits-config'));
});

test('a global limit pauses the heartbeats of every project, since account.json is shared', () => {
  const box = sandbox();
  const dirs = ['one', 'two'].map((name) => {
    assert.equal(box.run('new', name).status, 0);
    const dir = realpathSync(join(box.root, name));
    for (const args of [['add', '-A'], ['commit', '-q', '-m', 'init']]) execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'ignore' });
    return dir;
  });
  writeFileSync(join(box.root, 'claude-config', '.claude.json'), JSON.stringify({ projects: Object.fromEntries(dirs.map((d) => [d, { hasTrustDialogAccepted: true }])) }));
  mkdirSync(join(box.root, '.config', 'jerome'), { recursive: true });
  writeFileSync(join(box.root, '.config', 'jerome', 'account.json'), JSON.stringify({ schema: 'jerome.account/v1',
    windows: { five_hour: { used: 59, resetsAt: Math.floor(Date.now() / 1000) + 3600, readAt: new Date().toISOString(), source: 'statusline' } }, limits: {} }));
  assert.equal(box.run('limits', 'one', '--five-hour', '50').status, 0);
  for (const name of ['one', 'two']) {
    box.run('heartbeat', name);
    const d = new DatabaseSync(sandboxDb(box.root, join(box.root, name)), { readOnly: true });
    assert.equal(d.prepare('SELECT reason FROM runs ORDER BY id DESC').get().reason, 'global limit: 5h 59% ≥ 50%', name);
    d.close();
  }
});

// Areas (D95-D102): three fronts of work with their pace and priority.
const AREAS = `# Areas

## development
- Goal: A web app people can sign up to.
- Milestone: MVP
- Criteria: sign-up and one list work
- Folder: .
- Agents: developer
- Pace: daily
- Priority: 1

## marketing
- Goal: 200 people on the waiting list.
- Milestone: pre-launch
- Criteria: landing page draft; three posts ready
- Folder: marketing/
- Agents: writer
- Pace: weekly
- Priority: 2

## research
- Goal: Know the three closest competitors.
- Milestone: survey
- Criteria: one page per competitor
- Folder: research/
- Pace: daily
- Priority: 3
`;

test('the triage chooses among the areas due; paused areas, open requests and paces cost nothing', () => {
  const p = project();
  writeFileSync(join(p.dir, '.jerome', 'areas.md'), AREAS);
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'areas');
  // Each call is logged with its arguments, the prompt's lines included: one entry per `-p`.
  const triages = () => p.calls().split(/^-p /m).filter((c) => c.includes('--model haiku'));

  // The triage picks marketing; the lead agent works there and opens a request, which belongs to the area.
  p.runWith({ FAKE_TRIAGE: '{"work": true, "area": "marketing", "task": "Draft the landing page"}', FAKE_LEAD_REQUEST: 'Pre-launch met: open launch?' }, 'heartbeat', 'demo');
  let run = p.lastRun();
  assert.deepEqual([run.status, run.area, run.reason], ['done', 'marketing', 'marketing: Draft the landing page']);
  assert.match(triages()[0], /### development · priority 1 · daily pace · last heartbeat never[\s\S]*### marketing · priority 2[\s\S]*### research · priority 3/);
  const lead = p.calls().split(/^-p /m).filter((c) => c.includes('--max-turns')).pop();
  assert.match(lead, /Area: marketing \(folder marketing\/; agents writer\)\. Milestone: pre-launch — criteria: landing page draft; three posts ready/);
  const d = p.db();
  assert.deepEqual({ ...d.prepare('SELECT id, area FROM requests').get() }, { id: 1, area: 'marketing' });
  d.close();

  // Marketing now waits for R1, and its weekly pace has not come round: a triage that picks it is not trusted.
  p.runWith({ FAKE_TRIAGE: '{"work": true, "area": "marketing", "task": "Write a post"}' }, 'heartbeat', 'demo');
  run = p.lastRun();
  assert.deepEqual([run.status, run.reason], ['failed', 'triage: the triage chose the area "marketing", which is not due']);
  // The verdict is kept with its run, the refused one too (D110).
  assert.deepEqual(JSON.parse(run.triage), { work: true, area: 'marketing', task: 'Write a post', reason: null, milestone: false });
  assert.doesNotMatch(triages().pop(), /### marketing/);

  // A triage with no work still records the subscription window its stream carries.
  p.runWith({ FAKE_TRIAGE: '{"work": false, "reason": "nothing ready"}', FAKE_TRIAGE_WINDOW: '0.33' }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().reason, 'no work: nothing ready');
  assert.equal(JSON.parse(p.lastRun().triage).reason, 'nothing ready');
  const account = JSON.parse(readFileSync(join(p.root, '.config', 'jerome', 'account.json'), 'utf8'));
  assert.deepEqual([account.windows.five_hour.used, account.windows.five_hour.source], [33, 'triage']);

  // With development and research paused, no area is due: the heartbeat ends before the triage.
  writeFileSync(join(p.dir, '.jerome', 'areas.md'), AREAS.replace(/- Pace: daily/g, '- Pace: paused'));
  p.git('commit', '-q', '-am', 'pause');
  const before = triages().length;
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().reason, 'no area due: development paused · marketing waiting for R1 · research paused');
  assert.equal(triages().length, before);

  // jerome state shows each area with its milestone and usage. The first heartbeat's usage, triage and lead agent, is
  // marketing's; the triages of the heartbeats that chose no area are shared.
  const state = p.run('state', 'demo', '--runs', '4');
  assert.match(state.stdout, /^areas   development MVP paused 7d 0 \$0\.00 API · marketing pre-launch waiting R1 7d 5k <\$0\.01 API · research survey paused 7d 0 \$0\.00 API · shared 7d 6k <\$0\.01 API$/m);
  assert.match(state.stdout, /heartbeat marketing done/);
  const json = JSON.parse(p.run('state', 'demo', '--json').stdout);
  assert.equal(json.areas.find((a) => a.name === 'marketing').week.tokens, 2000 + 3040);
  assert.equal(json.shared.tokens, 2 * 3040);

  // doctor names the agents without a file and the folders that do not exist yet.
  const warnings = JSON.parse(p.run('doctor', 'demo', '--check', '--json').stdout).warnings.filter((w) => w.id === 'areas').map((w) => w.message);
  assert.ok(warnings.some((m) => /area "development" lists developer, with no file/.test(m)));
  assert.ok(warnings.some((m) => /the folder of area "marketing", marketing\/, does not exist yet/.test(m)));
});

test('jerome request open takes an area, which must exist', () => {
  const p = project();
  writeFileSync(join(p.dir, '.jerome', 'areas.md'), AREAS);
  const req = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, '..', 'bin', 'jerome.js'), 'request', 'open', ...args],
    { cwd: p.dir, encoding: 'utf8', env: { ...process.env, HOME: p.root, XDG_DATA_HOME: '', XDG_CONFIG_HOME: '', XDG_CACHE_HOME: '' } });
  assert.equal(req('--question', 'Which audience first?', '--area', 'marketing').status, 0);
  const bad = req('--question', 'x', '--area', 'sales');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /There is no area sales; the areas are development, marketing, research/);
  const d = p.db();
  assert.equal(d.prepare("SELECT area FROM requests WHERE question = 'Which audience first?'").get().area, 'marketing');
  d.close();
});

test('caps given to one heartbeat by hand replace those of the project for that run only (D108)', () => {
  const p = project({ FAKE_TRIAGE: '{"work": true, "task": "Try the caps"}' });
  const marker = () => readFileSync(join(p.dir, '.jerome', 'project.json'), 'utf8');
  const before = marker();
  p.runWith({ FAKE_LEAD_CALLS: '5', FAKE_LEAD_SLEEP: '0.05' }, 'heartbeat', 'demo', '--max-tokens', '2500');
  assert.equal(p.lastRun().status, 'stopped');
  assert.match(p.lastRun().reason, /^token cap: [\d,]+ tokens over 2,500 \(this run; main \dk\)$/);
  p.runWith({ FAKE_LEAD_RESULT: 'error_max_turns' }, 'heartbeat', 'demo', '--max-turns', '7');
  assert.equal(p.lastRun().reason, 'turn cap: 7 turns (this run)');
  assert.deepEqual(JSON.parse(p.lastRun().caps), { maxTokens: 500000, maxTurns: 7, once: true });
  assert.match(p.calls().split(/^-p /m).filter((c) => c.includes('--max-turns')).pop(), /--max-turns 7 /);
  assert.equal(marker(), before, 'project.json is not touched');
  assert.equal(p.run('heartbeat', 'demo', '--max-tokens', 'lots').status, 2);
});

test('the token cap counts the subagents too, from their transcripts, when the stream does not carry them (D109)', () => {
  const p = project({ FAKE_TRIAGE: '{"work": true, "task": "Read the docs"}', JEROME_METER_MS: '50' });
  p.runWith({ FAKE_LEAD_CALLS: '20', FAKE_LEAD_SLEEP: '0.2', FAKE_SUB_TOKENS: '50000' }, 'heartbeat', 'demo', '--max-tokens', '120000');
  const run = p.lastRun();
  assert.equal(run.status, 'stopped');
  assert.match(run.reason, /^token cap: [\d,]+ tokens over 120,000 \(this run; researcher 1\d\dk, main \dk\)$/);
  // Stopped after a few calls, not after the twenty the stream alone would have allowed.
  const d = p.db();
  assert.ok(d.prepare("SELECT count(*) n FROM usage WHERE run_id = ? AND agent = 'main'").get(run.id).n < 10);
  d.close();
});

test('a stopped run goes back to the branch it started from, and leaves uncommitted changes to the user (D112)', () => {
  const p = project({ FAKE_TRIAGE: '{"work": true, "task": "Half a task"}', FAKE_LEAD_RESULT: 'error_max_turns' });
  const branch = () => execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: p.dir, encoding: 'utf8' }).trim();
  const start = branch();
  p.runWith({ FAKE_LEAD_BRANCH: 'task/empty' }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().reason, `turn cap: 40 turns; branch task/empty left, no commits: removed, back on ${start}`);
  assert.equal(branch(), start);
  p.runWith({ FAKE_LEAD_BRANCH: 'task/some', FAKE_LEAD_COMMIT: '1' }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().reason, `turn cap: 40 turns; branch task/some left, 1 commit: kept, back on ${start}`);
  assert.equal(branch(), start);
  p.runWith({ FAKE_LEAD_BRANCH: 'task/dirty', FAKE_LEAD_DIRTY: '1' }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().reason, 'turn cap: 40 turns; uncommitted changes left on task/dirty');
  assert.equal(branch(), 'task/dirty');
  assert.match(p.requests().pop().question, /stopped halfway on branch task\/dirty and left uncommitted changes/);
});

// A local server for the pages an area follows: GET /docs/<name>.md serves <root>/pages/<name>.md, or 404.
async function pageServer(root) {
  mkdirSync(join(root, 'pages'), { recursive: true });
  const code = `require('node:http').createServer((q, s) => { const f = require('node:path').join(${JSON.stringify(join(root, 'pages'))}, q.url.replace(/^\\/docs\\//, ''));
    try { s.end(require('node:fs').readFileSync(f)); } catch { s.statusCode = 404; s.end(); } })
    .listen(0, '127.0.0.1', function () { require('node:fs').writeFileSync(${JSON.stringify(join(root, 'port'))}, String(this.address().port)); });`;
  const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
  while (!existsSync(join(root, 'port'))) await new Promise((r) => setTimeout(r, 20));
  return { port: Number(readFileSync(join(root, 'port'), 'utf8')), stop: () => child.kill() };
}

test('an area paced by the pages it follows is due only when one changed, and its agents read the saved copy (D111)', async () => {
  const p = project();
  const server = await pageServer(p.root);
  try {
    const page = (text) => (text === null ? rmSync(join(p.root, 'pages', 'hooks.md'), { force: true }) : writeFileSync(join(p.root, 'pages', 'hooks.md'), text));
    const base = `http://127.0.0.1:${server.port}/docs`;
    page('# Hooks\nSessionStart sources: startup, resume.\n');
    writeFileSync(join(p.dir, '.jerome', 'areas.md'), `# Areas\n\n## research\n- Goal: Follow the hooks page.\n- Milestone: routine\n- Criteria: a report per change\n- Folder: research/\n- Pace: hourly\n- Priority: 1\n- Trigger: watch\n`);
    writeFileSync(join(p.dir, '.jerome', 'scope.md'), `# Scope\n\n## Area: research\n- Watch: ${base}/hooks, https://example.org/other\n`);
    const settings = join(p.dir, '.claude', 'settings.json');
    const s = JSON.parse(readFileSync(settings, 'utf8'));
    s.permissions.allow.push('WebFetch(domain:127.0.0.1)');
    writeFileSync(settings, JSON.stringify(s, null, 2));
    p.git('add', '-A');
    p.git('commit', '-q', '-m', 'watch');
    // Pace is not what holds the area back here: each heartbeat is made to look an hour older.
    const age = () => { const d = new DatabaseSync(sandboxDb(p.root, p.dir)); d.exec("UPDATE runs SET started_at = '2000-01-01T00:00:00.000Z'"); d.close(); };

    p.runWith({ FAKE_TRIAGE: '{"work": true, "area": "research", "task": "Report the changes"}' }, 'heartbeat', 'demo');
    assert.equal(p.lastRun().reason, 'research: Report the changes (research: skipped outside the WebFetch domains: https://example.org/other)');
    const saved = `.jerome/watch/127.0.0.1:${server.port}/docs/hooks.md`;
    assert.equal(readFileSync(join(p.dir, saved), 'utf8'), '# Hooks\nSessionStart sources: startup, resume.\n');
    assert.ok(p.calls().split(/^-p /m).filter((c) => c.includes('--max-turns')).pop().includes(`saved whole in ${saved}: have them read there with Read`));
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: p.dir, encoding: 'utf8' }), '', 'the saved pages stay out of git');

    age();
    const triages = () => p.calls().split(/^-p /m).filter((c) => c.includes('--model haiku')).length;
    const before = triages();
    p.run('heartbeat', 'demo');
    assert.match(p.lastRun().reason, /^no area due: research pages unchanged/);
    assert.equal(triages(), before, 'unchanged pages cost no triage');

    page('# Hooks\nSessionStart sources: startup, resume, clear, compact, fork.\n');
    age();
    p.runWith({ FAKE_TRIAGE: '{"work": false, "reason": "only a wording change"}' }, 'heartbeat', 'demo');
    assert.match(p.lastRun().reason, /^no work: only a wording change/);
    assert.equal(triages(), before + 1);

    page(null);
    age();
    p.run('heartbeat', 'demo');
    assert.match(p.lastRun().reason, new RegExp(`^no area due: research page unreachable: ${base}/hooks`));
  } finally {
    server.stop();
  }
});
