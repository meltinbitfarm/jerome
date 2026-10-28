// Autonomous runs made failure-proof (D118-D125), on throwaway git repositories with a fake `claude` and a fake
// `launchctl`: the acceptance tests of the task that led to them, one per test, in its order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readyProject } from './sandbox.js';
import { jobLabel } from '../src/schedule.js';
import { marathon, marathonDeadline } from '../src/heartbeatcmd.js';
import { lockPath } from '../src/runstate.js';

const WORK = '{"work": true, "task": "Write the report"}';

// The project with extras: its settings, its branch and tracked tree, its alerts, and the files the fake claude
// leaves in the sandbox's home.
function project(env = {}) {
  const p = readyProject(env);
  const branch = () => execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: p.dir, encoding: 'utf8' }).trim();
  const tracked = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: p.dir, encoding: 'utf8' });
  const settings = (heartbeat) => {
    const path = join(p.dir, '.jerome', 'project.json');
    const marker = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, `${JSON.stringify({ ...marker, heartbeat: { ...marker.heartbeat, ...heartbeat } }, null, 2)}\n`);
    p.git('add', '.jerome/project.json');
    p.git('commit', '-q', '-m', 'settings');
  };
  const alerts = () => {
    const d = p.db();
    const rows = d.prepare("SELECT id, key, reason, count FROM alerts WHERE status = 'open' ORDER BY id").all();
    d.close();
    return rows;
  };
  const home = (file) => join(p.root, file);
  // The lock the sandbox's CLI uses: its cache is under the sandbox's home.
  const lock = join(p.root, '.cache', 'jerome', 'locks', `${jobLabel(p.dir)}.lock`);
  return { ...p, branch, tracked, settings, alerts, home, lock };
}

test('1. on a work branch with uncommitted changes, the run resumes that work and ends on main with a clean tree', () => {
  const p = project({ FAKE_TRIAGE: WORK });
  writeFileSync(join(p.dir, 'notes.txt'), 'first\n');
  p.git('add', 'notes.txt');
  p.git('commit', '-q', '-m', 'notes');
  p.git('switch', '-q', '-c', 'agent/half-done');
  writeFileSync(join(p.dir, 'notes.txt'), 'first\nsecond, half done\n');

  const r = p.runWith({ FAKE_LEAD_FINISH: '1' }, 'heartbeat', 'demo');
  assert.equal(r.status, 0, r.stderr);
  const run = p.lastRun();
  assert.equal(run.mode, 'resume');
  assert.equal(run.status, 'done', run.reason);
  assert.match(run.reason, /^resume: the work branch agent\/half-done with uncommitted changes \(notes\.txt\) → done$/);
  assert.deepEqual(JSON.parse(run.outcome), { ok: true, failures: [], notes: [] });
  assert.equal(run.exit_code, 0);
  assert.equal(p.branch(), 'main');
  assert.equal(p.tracked(), '');
  assert.match(readFileSync(join(p.dir, 'notes.txt'), 'utf8'), /second, half done/);
  // No triage in RESUME mode: the task is the half-done work, and the prompt says so.
  assert.doesNotMatch(p.calls(), /--model haiku/);
  assert.match(readFileSync(p.home('lead-prompt'), 'utf8'), /RESUME mode: an earlier run left work half done: the work branch agent\/half-done/);
  // The user's own changes on main are never resumed: they are skipped with an alert at once.
  writeFileSync(join(p.dir, 'notes.txt'), 'mine\n');
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'blocked');
  assert.match(p.lastRun().reason, /^uncommitted changes \(notes\.txt\) on main, not left by a heartbeat/);
  assert.equal(p.alerts().length, 1);
});

test('2. the lead agent waits for its subagents with no ceiling, and the runner bounds it only by the max duration', () => {
  const p = project({ FAKE_TRIAGE: WORK });
  // Three calls a second apart: a lead agent still busy well after it started is waited for.
  p.runWith({ FAKE_LEAD_CALLS: '3', FAKE_LEAD_SLEEP: '1' }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'done', p.lastRun().reason);
  // claude -p kills background tasks 10 minutes after the last turn unless this is 0 (D120); and it is a heartbeat.
  assert.equal(readFileSync(p.home('lead-env'), 'utf8').trim(), 'ceiling=0 kind=heartbeat');
  assert.match(readFileSync(p.home('lead-prompt'), 'utf8'), /in the foreground: wait for every result before going on, never start one in the background/);
});

test('3. past the max duration the whole process tree is stopped, an alert is written at once, and the next run resumes', () => {
  const p = project({ FAKE_TRIAGE: WORK });
  p.settings({ maxMinutes: 0.02 });
  const started = Date.now();
  p.runWith({ FAKE_LEAD_CALLS: '30', FAKE_LEAD_SLEEP: '1', FAKE_LEAD_GRANDCHILD: '1', FAKE_LEAD_BRANCH: 'agent/slow', FAKE_LEAD_COMMIT: '1' }, 'heartbeat', 'demo');
  assert.ok(Date.now() - started < 15_000, 'stopped long before the lead agent would have ended');
  const run = p.lastRun();
  assert.equal(run.status, 'stopped');
  assert.match(run.reason, /^max duration: 0\.02 min, process tree stopped; end check: over the max duration of 0\.02 min, process tree stopped; ended on branch agent\/slow, not main; .*branch agent\/slow left, 1 commit: kept, back on main; next run resumes$/);
  // What claude left running in the background was stopped with it.
  const pid = Number(readFileSync(p.home('grandchild.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  // One alert, at once, not on the second time.
  assert.deepEqual(p.alerts().map((a) => [a.key, a.count]), [['max duration', 1]]);
  assert.match(p.lastRun().reason, /next run resumes/);
  assert.equal(p.branch(), 'main');

  p.settings({ maxMinutes: 90 });
  p.runWith({ FAKE_LEAD_FINISH: '1' }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().mode, 'resume');
  assert.match(p.lastRun().reason, /^resume: unmerged work branch agent\/slow \(left by the heartbeat of .*: over the max duration/);
  assert.equal(p.lastRun().status, 'done', p.lastRun().reason);
  assert.deepEqual(p.alerts(), [], 'a run that ends well closes the alerts');
});

test('4. two skips in a row for the same reason open an alert, shown in jerome state, at session start and in jerome projects', () => {
  const p = project({ JEROME_NOTIFY_LOG: '' });
  const log = join(p.root, 'notified.log');
  const later = Math.floor(Date.now() / 1000) + 86_400;
  p.account({ windows: { seven_day: { used: 60, resetsAt: later, readAt: new Date().toISOString(), source: 'statusline' } }, limits: { seven_day: 75 } });
  // The project's own threshold on the 7-day window (D124) pauses it below the global limit.
  p.settings({ quota: { sevenDay: 50 } });
  p.runWith({ JEROME_NOTIFY_LOG: log }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().reason, 'global limit: 7d 60% ≥ 50%');
  assert.equal(p.alerts().length, 0, 'one skip is not an alert');
  p.runWith({ JEROME_NOTIFY_LOG: log }, 'heartbeat', 'demo');
  assert.deepEqual(p.alerts().map((a) => a.reason), ['global limit: 7d 60% ≥ 50%']);
  // The pause had its one notification (D85); the alert does not add another.
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);

  const state = p.run('state', 'demo').stdout.split('\n');
  assert.match(state[1], /^ALERTS {2}A1 global limit: 7d 60% ≥ 50% \(/);
  const start = JSON.parse(p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir }, JSON.stringify({ cwd: p.dir, session_id: 'talk', source: 'startup' }), 'hook', 'session-start').stdout);
  assert.match(start.hookSpecificOutput.additionalContext, /^Heartbeat alerts: .*Tell the user about them first[\s\S]*A1: global limit: 7d 60% ≥ 50% \(2 runs lost since /);
  assert.match(start.systemMessage, /^Jérôme: 1 heartbeat alert: A1 global limit/);
  const overview = JSON.parse(p.run('projects', '--json').stdout).projects[0];
  assert.match(overview.attention[0], /^1 heartbeat alert: A1 global limit/);

  // The override lifts the pause for the day, and the run that then ends well closes the alert.
  assert.equal(p.run('heartbeat', 'override', 'demo', '--today').status, 0);
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'done');
  assert.match(p.lastRun().reason, /\(quota override for today\)$/);
  assert.deepEqual(p.alerts(), []);

  // A branch that is not a heartbeat's: skipped with an alert at once, never touched.
  p.git('switch', '-q', '-c', 'feature/mine');
  p.run('heartbeat', 'demo');
  assert.match(p.lastRun().reason, /^on branch feature\/mine, neither main nor a work branch \(agent\/\*\)/);
  assert.equal(p.alerts().length, 1);
  assert.equal(p.branch(), 'feature/mine');
});

test('5. a marathon until 24:00 started at 21:00 stops at midnight and never runs the next day', async () => {
  const p = project();
  const start = new Date(2026, 9, 27, 21, 0);
  assert.deepEqual(marathonDeadline('24:00', start), new Date(2026, 9, 28, 0, 0));
  assert.deepEqual(marathonDeadline('23:30', start), new Date(2026, 9, 27, 23, 30));
  assert.equal(marathonDeadline('24:30', start), null);

  let clock = start.getTime();
  const runs = [];
  const results = [{ worked: true }, { worked: false, status: 'blocked' }, { worked: true }];
  const code = await marathon(p.dir, {
    until: '24:00',
    now: () => new Date(clock),
    sleep: async (ms) => { clock += ms; },
    runOnce: async () => {
      runs.push(new Date(clock));
      clock += 25 * 60_000;
      return { status: 'done', ...results[(runs.length - 1) % results.length] };
    },
    timing: { pauseMs: 2 * 60_000, backoffMs: 30 * 60_000, lockPollMs: 60_000 },
    log: () => {},
  });
  assert.equal(code, 0);
  assert.ok(runs.length >= 4, `${runs.length} runs`);
  for (const r of runs) assert.ok(r < new Date(2026, 9, 28, 0, 0) && r.getDate() === 27, `run at ${r.toString()}`);
  assert.ok(clock >= new Date(2026, 9, 28, 0, 0).getTime());
  // A short pause after real work, the long back-off after a skip.
  assert.equal(runs[1] - runs[0], 27 * 60_000);
  assert.equal(runs[2] - runs[1], 55 * 60_000);

  // Started after its time, it does not run at all (before D123, an hour compared alone ran into the next day).
  const late = await marathon(p.dir, { until: '22:00', now: () => new Date(2026, 9, 27, 23, 0), runOnce: async () => assert.fail('ran'), log: () => {} });
  assert.equal(late, 2);

  // While another heartbeat holds the lock, it waits instead of starting one.
  mkdirSync(join(lockPath(p.dir), '..'), { recursive: true });
  writeFileSync(lockPath(p.dir), String(process.pid));
  clock = new Date(2026, 9, 27, 23, 50).getTime();
  let waited = 0;
  const after = [];
  await marathon(p.dir, {
    until: '24:00', now: () => new Date(clock),
    sleep: async (ms) => { clock += ms; waited += 1; if (waited === 3) rmSync(lockPath(p.dir)); },
    runOnce: async () => { after.push(new Date(clock)); clock += 60_000; return { status: 'done', worked: true }; },
    log: () => {},
  });
  assert.deepEqual(after.map((d) => d.getMinutes()), [53, 56, 59]);
});

test('6. a stale lock from a dead process does not block, and a live one does', () => {
  const p = project();
  mkdirSync(join(p.lock, '..'), { recursive: true });
  writeFileSync(p.lock, '999999');
  p.run('heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'done');
  assert.ok(!existsSync(p.lock));
  writeFileSync(p.lock, String(process.pid));
  p.run('heartbeat', 'demo');
  assert.match(p.lastRun().reason, /^locked/);
  // A run that finds the lock taken is not an alert, even twice: a lock clears by itself.
  p.run('heartbeat', 'demo');
  assert.deepEqual(p.alerts(), []);
  rmSync(p.lock);
});

test('7. while a heartbeat runs, an interactive session cannot change the repository in the same working tree', () => {
  const p = project();
  const bash = (command, extra = {}) => p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir, ...extra }, JSON.stringify({ cwd: p.dir, session_id: 'talk', tool_name: 'Bash', tool_input: { command } }), 'hook', 'pre-tool-use').stdout;
  assert.equal(bash('git commit -m "state"'), '', 'no heartbeat running: allowed');
  mkdirSync(join(p.lock, '..'), { recursive: true });
  writeFileSync(p.lock, String(process.pid));
  const denied = JSON.parse(bash('git commit -m "state"')).hookSpecificOutput;
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, new RegExp(`A heartbeat of this project is running in this working tree \\(pid ${process.pid}\\)[\\s\\S]*git worktree add`));
  for (const command of ['git switch main', 'git add notes.txt', 'git stash', 'git merge agent/x']) assert.match(bash(command), /"deny"/, command);
  for (const command of ['git status', 'git log --oneline -3', 'git diff', 'git worktree add ../demo-wt -b mine', 'jerome heartbeat status']) assert.equal(bash(command), '', command);
  // The heartbeat's own session is never refused.
  assert.equal(bash('git commit -m "work"', { JEROME_RUN_KIND: 'heartbeat' }), '');
  const d = p.db();
  assert.equal(d.prepare("SELECT count(*) n FROM events WHERE kind = 'blocked' AND data LIKE '%\"heartbeat\":%'").get().n, 5);
  d.close();
  rmSync(p.lock);
  assert.equal(bash('git commit -m "state"'), '');
});

test('8. install and uninstall are idempotent, slots run with their text, and status lists the runs and open alerts', () => {
  const p = project({ FAKE_TRIAGE: WORK });
  assert.equal(p.run('heartbeat', 'install', 'demo').status, 2, 'no slots yet');
  p.settings({ slots: [{ name: 'morning', at: ['09:00'] }, { name: 'evening', at: ['18:00', '21:30'], days: ['mon', 'fri'], text: 'Polish the copy only.' }], test: 'npm test' });
  const agents = join(p.root, 'Library', 'LaunchAgents');
  const files = () => readdirSync(agents).sort().map((f) => [f, readFileSync(join(agents, f), 'utf8')]);
  const first = p.run('heartbeat', 'install', 'demo');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /✓ slot morning: 09:00 \(.*\.morning\)\n  allowed: Bash\(npm test\), Bash\(npm test:\*\)\n✓ slot evening: 18:00, 21:30 on mon, fri/);
  const once = files();
  assert.equal(once.length, 2);
  const evening = once.find(([f]) => f.endsWith('.evening.plist'))[1];
  assert.match(evening, /<string>heartbeat<\/string>\s*<string>run<\/string>\s*<string>evening<\/string>/);
  assert.equal(evening.match(/<key>Weekday<\/key>/g).length, 4);
  assert.match(evening, /<key>PATH<\/key><string>[^<]*\/bin[^<]*<\/string>/);
  assert.equal(p.run('heartbeat', 'install', 'demo').status, 0);
  assert.deepEqual(files(), once, 'installing again changes nothing');
  assert.match(p.run('doctor', 'demo').stdout, /✓ Heartbeat job — scheduled and loaded/);

  // A slot's run gives its text to the triage and the lead agent; an unknown slot is an alert at once.
  p.run('heartbeat', 'run', 'evening', 'demo');
  assert.equal(p.lastRun().slot, 'evening');
  assert.match(p.calls(), /## This run's slot: evening\nPolish the copy only\./);
  assert.match(readFileSync(p.home('lead-prompt'), 'utf8'), /This run's slot \(evening\): Polish the copy only\.[\s\S]*Verify with `npm test`/);
  p.run('heartbeat', 'run', 'night', 'demo');
  assert.match(p.lastRun().reason, /^no slot "night"/);

  // A slot removed from the settings: its job goes at the next install.
  p.settings({ slots: [{ name: 'morning', at: ['09:00'] }] });
  assert.match(p.run('heartbeat', 'install', 'demo').stdout, /✓ removed .*\.evening, no longer in the settings/);
  assert.equal(files().length, 1);

  const status = p.run('heartbeat', 'status', 'demo');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^jobs {5}morning 09:00 \(loaded\)$/m);
  assert.match(status.stdout, /^now {6}no heartbeat running$/m);
  assert.match(status.stdout, /^ {2}A1 no slot "night"/m);
  assert.match(status.stdout, /^runs {5}last 2\n.* blocked \[night, \d+ min\] no slot "night"[\s\S]* done \[normal, evening, \d+ min, exit 0, end check ok\] Write the report$/m);

  assert.equal(p.run('heartbeat', 'uninstall', 'demo').status, 0);
  assert.equal(files().length, 0);
  const again = p.run('heartbeat', 'uninstall', 'demo');
  assert.equal(again.status, 0);
  assert.match(again.stdout, /No heartbeat jobs were installed/);
  // Bad settings are refused by install and reported by doctor, never half applied.
  p.settings({ slots: [{ name: 'Morning!', at: ['9am'] }], maxMinutes: -1 });
  const bad = p.run('heartbeat', 'install', 'demo');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /heartbeat\.maxMinutes must be a positive number[\s\S]*heartbeat\.slots\[0\]\.name must be lower-case/);
  assert.equal(files().length, 0);
});

test('staging everything instead of named paths is refused in every session, heartbeat or not (D125)', () => {
  const p = project();
  const bash = (command, extra = {}) => p.runWithInput({ CLAUDE_PROJECT_DIR: p.dir, ...extra }, JSON.stringify({ cwd: p.dir, session_id: 'talk', tool_name: 'Bash', tool_input: { command } }), 'hook', 'pre-tool-use').stdout;
  for (const command of ['git commit -am "wip"', 'git commit --all -m x', 'git add -A', 'git add .', 'git add -u']) {
    assert.match(JSON.parse(bash(command)).hookSpecificOutput.permissionDecisionReason, /^Stage the paths this task changed by name/, command);
    assert.match(bash(command, { JEROME_RUN_KIND: 'heartbeat' }), /"deny"/, command);
  }
  for (const command of ['git add src/a.js notes.txt', 'git commit -m "add -A later"', 'git commit --amend --no-edit', 'git add -p src']) assert.equal(bash(command), '', command);
});

test('changes on main limited to the state files are committed by the run, which then starts; code changes still stop it (D127)', () => {
  const p = project({ FAKE_TRIAGE: WORK });
  // The run commits as the repository's user, as any commit there.
  p.git('config', 'user.email', 't@example.com');
  p.git('config', 'user.name', 't');
  writeFileSync(join(p.dir, '.jerome', 'open.md'), '# Open\n');
  p.git('add', '.jerome/open.md');
  p.git('commit', '-q', '-m', 'open');
  writeFileSync(join(p.dir, '.jerome', 'open.md'), '# Open\n\n- an assumption noted in a session\n');
  p.run('heartbeat', 'demo');
  const run = p.lastRun();
  assert.equal(run.status, 'done', run.reason);
  assert.match(run.reason, /\(state files carried over: \.jerome\/open\.md\)/);
  assert.match(execFileSync('git', ['log', '--format=%s', '-3'], { cwd: p.dir, encoding: 'utf8' }), /State: carried over from the interactive session/);
  assert.equal(p.tracked(), '');
  assert.deepEqual(p.alerts(), []);

  // With a code file among them, nothing is committed: the run stops with an alert, as before.
  writeFileSync(join(p.dir, '.jerome', 'open.md'), '# Open\n\n- another\n');
  writeFileSync(join(p.dir, 'README.md'), 'mine\n');
  p.git('add', 'README.md');
  p.git('commit', '-q', '-m', 'readme');
  writeFileSync(join(p.dir, 'README.md'), 'mine, changed\n');
  p.run('heartbeat', 'demo');
  assert.match(p.lastRun().reason, /^uncommitted changes \(\.jerome\/open\.md, README\.md\) on main, not left by a heartbeat/);
  assert.match(p.tracked(), /\.jerome\/open\.md/);
  assert.equal(p.alerts().length, 1);
});

test('an alert still open is notified and pushed again every few hours, with the runs it has cost (D128)', () => {
  const p = project();
  const log = join(p.root, 'notified.log');
  p.settings({ alerts: { command: 'cat >> "$HOME/pushed.log"' } });
  writeFileSync(join(p.dir, 'README.md'), 'mine\n');
  p.git('add', 'README.md');
  p.git('commit', '-q', '-m', 'readme');
  writeFileSync(join(p.dir, 'README.md'), 'mine, changed\n');
  p.runWith({ JEROME_NOTIFY_LOG: log }, 'heartbeat', 'demo');
  p.runWith({ JEROME_NOTIFY_LOG: log }, 'heartbeat', 'demo');
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1, 'no reminder within the hours');
  // Three hours later, the next run reminds.
  const sent = join(p.root, '.cache', 'jerome', 'notified', `${jobLabel(p.dir)}.alerts.json`);
  writeFileSync(sent, JSON.stringify({ 1: new Date(Date.now() - 3.5 * 3_600_000).toISOString() }));
  p.runWith({ JEROME_NOTIFY_LOG: log }, 'heartbeat', 'demo');
  const notified = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(notified.length, 2);
  assert.match(notified[1], /^demo: Alert A1 still open, 3 runs lost since \d{4}-\d\d-\d\d \d\d:\d\d: uncommitted changes \(README\.md\)/);
  assert.match(readFileSync(p.home('pushed.log'), 'utf8'), /A1: uncommitted[\s\S]*A1 still open, 3 runs lost/);

  const status = p.run('heartbeat', 'status', 'demo').stdout;
  assert.match(status, /^alerts {3}1 open, 3 runs lost: tell the user$/m);
  assert.match(status, /^ {2}A1 uncommitted changes .* · 3 runs lost since /m);
  assert.match(JSON.parse(p.run('projects', '--json').stdout).projects[0].attention[0], /^1 heartbeat alert: A1 uncommitted changes .*\(3 runs lost since /);
});

test('a run is given the test command and the allowed tools, and one refused a tool ends blocked with an alert (D129)', () => {
  const p = project({ FAKE_TRIAGE: WORK });
  p.settings({ allow: ['not a rule!'] });
  assert.match(p.run('doctor', 'demo').stdout, /heartbeat\.allow: "not a rule!" is not a permission rule/);
  p.settings({ test: 'npm test', allow: ['Bash(./tools/fetch.sh:*)'], slots: [{ name: 'evening', at: ['18:00'], allow: ['WebFetch(domain:example.org)'] }] });
  assert.equal(p.run('heartbeat', 'install', 'demo').status, 0);
  p.runWith({ FAKE_LEAD_DENIED: 'npm run e2e' }, 'heartbeat', 'run', 'evening', 'demo');
  assert.match(p.calls(), /--allowedTools Bash\(npm test\) Bash\(npm test:\*\) Bash\(\.\/tools\/fetch\.sh:\*\) WebFetch\(domain:example\.org\)$/m);
  const run = p.lastRun();
  assert.equal(run.status, 'blocked');
  assert.match(run.reason, /^permission denied for Bash\(npm run e2e\): add the rules to heartbeat\.allow in \.jerome\/project\.json$/);
  assert.equal(JSON.parse(run.outcome).ok, true, 'the end check alone would have called it done');
  assert.deepEqual(p.alerts().map((a) => a.key), ['permission denied']);
  // A deny rule of the project's is a refusal on purpose: the run is done, and the alert closes.
  p.runWith({ FAKE_LEAD_DENIED: 'git push', FAKE_LEAD_DENIED_TYPE: 'rule' }, 'heartbeat', 'demo');
  assert.equal(p.lastRun().status, 'done', p.lastRun().reason);
  assert.doesNotMatch(p.calls().trim().split('\n').pop(), /WebFetch/, 'a slot\'s rules are for its runs only');
  assert.deepEqual(p.alerts(), []);
});
