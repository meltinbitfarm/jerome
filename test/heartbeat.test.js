// Tests of phase 8: scheduling, the heartbeat's checks and caps, decision requests and the digest, with a fake
// `claude` and a fake `launchctl` on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sandbox } from './sandbox.js';
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
  const db = () => new DatabaseSync(join(dir, '.jerome.db'), { readOnly: true });
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
  writeFileSync(join(p.dir, 'CLAUDE.md'), 'changed\n');
  p.run('heartbeat', 'demo');
  assert.match(p.lastRun().reason, /uncommitted changes \(CLAUDE\.md\)/);
  p.git('checkout', '--', 'CLAUDE.md');

  // digest.md is the lead agent's to append to: it never counts as uncommitted.
  writeFileSync(join(p.dir, 'digest.md'), '- 2026-10-15 09:00 · did x\n');
  p.git('add', 'digest.md');
  p.git('commit', '-q', '-m', 'digest');
  writeFileSync(join(p.dir, 'digest.md'), '- 2026-10-15 09:00 · did x\n- 2026-10-15 10:00 · did y\n');
  // Nor does .jerome, which `jerome schedule` changes.
  writeFileSync(join(p.dir, '.jerome'), readFileSync(join(p.dir, '.jerome'), 'utf8').replace('"files"', '"heartbeat": {},\n  "files"'));

  writeFileSync(join(p.dir, 'PROJECT.md'), '<!-- jerome:provisional -->\n# Provisional\n');
  p.git('add', 'PROJECT.md');
  p.git('commit', '-q', '-m', 'provisional');
  p.run('heartbeat', 'demo');
  assert.match(p.lastRun().reason, /PROJECT\.md is provisional/);
  p.git('rm', '-q', 'PROJECT.md');
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
  const inProject = (...args) => spawnSync(process.execPath, [new URL('../bin/jerome.js', import.meta.url).pathname, ...args], { cwd: p.dir, encoding: 'utf8' });
  assert.equal(inProject('request', 'answer', 'R1', 'No,', 'fix', 'the', 'tests', 'first').status, 0);
  assert.equal(p.requests().length, 0);
  assert.equal(inProject('request', 'answer', '1', 'again').status, 1);
  assert.equal(inProject('request', 'drop', '7').status, 1);
  assert.equal(inProject('request', 'open').status, 2);
});

test('jerome digest puts the lead agent\'s lines and the figures together at no token cost', () => {
  const p = project();
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(p.dir, 'digest.md'), `# Digest\n\n- 2020-01-01 09:00 · old work\n- ${today} 09:00 · wrote the parser · task/parser merged · none\n`);
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
  assert.match(r.stdout, /every day at 07:30, at most 500,000 tokens and 40 turns per run/);
  const marker = JSON.parse(readFileSync(join(p.dir, '.jerome'), 'utf8'));
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

  assert.match(p.run('schedule', '--list').stdout, /every day at 07:30/);
  assert.equal(p.run('schedule', 'demo', '--off').status, 0);
  assert.equal(JSON.parse(readFileSync(join(p.dir, '.jerome'), 'utf8')).heartbeat, undefined);
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
  writeFileSync(join(p.dir, '.jerome'), readFileSync(join(p.dir, '.jerome'), 'utf8').replace('"files"', '"limits": { "daily": 0.01, "weekly": null },\n  "files"'));
  const d = new DatabaseSync(join(p.dir, '.jerome.db'));
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
  const d = new DatabaseSync(join(p.dir, '.jerome.db'));
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
  assert.deepEqual(JSON.parse(readFileSync(join(p.dir, '.jerome'), 'utf8')).limits, { weekly: 30 });
  assert.equal(p.run('limits', 'demo', '--weekly', 'default').status, 0);
  assert.equal(JSON.parse(readFileSync(join(p.dir, '.jerome'), 'utf8')).limits, undefined);
  assert.equal(p.run('limits', 'demo', '--weekly', '30').status, 0);
  assert.equal(p.run('limits', 'demo', '--five-hour', '170').status, 2);
  assert.equal(p.run('limits', 'demo', '--daily', '-1').status, 2);
  writeFileSync(join(p.dir, '.jerome'), readFileSync(join(p.dir, '.jerome'), 'utf8').replace('"weekly": 30', '"weekly": "lots"'));
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
    const d = new DatabaseSync(join(box.root, name, '.jerome.db'), { readOnly: true });
    assert.equal(d.prepare('SELECT reason FROM runs ORDER BY id DESC').get().reason, 'global limit: 5h 59% ≥ 50%', name);
    d.close();
  }
});
