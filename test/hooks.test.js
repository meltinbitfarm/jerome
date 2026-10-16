// Tests of phase 6: the chained-command check, the hooks, the status line and their configuration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sandbox, sandboxDb } from './sandbox.js';
import { splitCommand, checkChain, changingGit } from '../src/chain.js';
import { replyShape, handback, requestsContext, CITED_FILE_CHARS } from '../src/hooks.js';

const COMMIT_HEREDOC = `git commit -F - <<'EOF'
Fix the parser && the tests; again | twice

Co-Authored-By: Someone <x@example.com>
EOF`;
const COMMIT_SUBSHELL = `git commit -m "$(cat <<'EOF'
Fabio's "quoted" fix (D49) && more; ok
EOF
)"`;

test('chained reads are allowed, and commit messages with && or ; never count as chains', () => {
  for (const command of [
    'git status && git diff',
    'git log --oneline | head -5',
    'git branch -a; git branch --show-current',
    'git stash list && git tag',
    'npm test 2>&1 | tail -3',
    'git commit -m "a && b; c | d"',
    "git commit -m 'a && b; c'",
    COMMIT_HEREDOC,
    COMMIT_SUBSHELL,
    'git commit -am x # && git push',
  ]) {
    assert.equal(checkChain(command), null, command);
  }
  assert.equal(splitCommand(COMMIT_HEREDOC).length, 1);
  assert.equal(splitCommand(COMMIT_SUBSHELL).length, 1);
});

test('chains with a git command that changes the repository are refused', () => {
  for (const [command, subcommands] of [
    ['git add -A && git commit -m x', ['add', 'commit']],
    ['cd sub && git commit -m x', ['commit']],
    ['npm test && git merge task/x', ['merge']],
    ['git switch main; git merge task/x', ['switch', 'merge']],
    ['git -C . commit -m x || true', ['commit']],
    ['FOO=1 git stash && git status', ['stash']],
    ['git branch feature && git log', ['branch']],
    ['echo start & git commit -m b', ['commit']],
    [`${COMMIT_HEREDOC}\ngit push`, ['commit', 'push']],
    [`${COMMIT_SUBSHELL} && git merge t`, ['commit', 'merge']],
  ]) {
    const verdict = checkChain(command);
    assert.ok(verdict, command);
    assert.deepEqual(verdict.subcommands, subcommands, command);
    assert.match(verdict.reason, /one per Bash call/);
  }
  assert.match(checkChain('git add a && git commit -m x').reason, /1\) git add a\n2\) git commit -m x/);
});

test('changingGit tells reading forms from changing ones', () => {
  for (const s of ['git status', 'git branch', 'git branch -a', 'git branch --list "t*"', 'git tag', 'git tag -l v1', 'git stash list', 'git checkout', 'git log', 'ls']) {
    assert.equal(changingGit(s), null, s);
  }
  for (const s of ['git branch -D t', 'git branch new', 'git tag v1', 'git stash', 'git stash pop', 'git checkout main', 'git worktree add ../x', 'git --no-pager -c a=b reset --hard']) {
    assert.ok(changingGit(s), s);
  }
});

test('replyShape counts words, lines and nested lists, never keeping the text', () => {
  assert.deepEqual(replyShape('Done.\n\n- a\n  - b\n'), { words: 5, lines: 3, nested: true });
  assert.deepEqual(replyShape(undefined), { words: 0, lines: 0, nested: false });
});

// A transcript line as Claude Code writes it.
const line = (id, output = 100, at = new Date().toISOString()) => `${JSON.stringify({
  type: 'assistant', requestId: id, timestamp: at,
  message: { model: 'claude-sonnet-5-5', content: [], usage: { input_tokens: 1, output_tokens: output, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } },
})}\n`;

function project() {
  const box = sandbox();
  assert.equal(box.run('new', 'demo').status, 0);
  const dir = realpathSync(join(box.root, 'demo'));
  const transcripts = join(box.root, 'transcripts');
  mkdirSync(join(transcripts, 's1', 'subagents'), { recursive: true });
  const hookCall = (event, payload) => box.runWithInput({ CLAUDE_PROJECT_DIR: dir }, JSON.stringify({ cwd: dir, session_id: 's1', ...payload }), 'hook', event);
  const db = () => new DatabaseSync(sandboxDb(box.root, dir), { readOnly: true });
  return { ...box, dir, transcripts, hookCall, db };
}

test('the hooks record a session: run, usage per agent, events with durations and reply lengths', () => {
  const { transcripts, hookCall, db } = project();
  const main = join(transcripts, 's1.jsonl');
  const sub = join(transcripts, 's1', 'subagents', 'agent-a1.jsonl');
  writeFileSync(main, line('m1') + line('m1', 300));
  writeFileSync(sub, line('a1', 50));

  assert.equal(hookCall('session-start', { source: 'startup', transcript_path: main }).status, 0);
  const subStop = hookCall('subagent-stop', {
    agent_id: 'a1', agent_type: 'developer', agent_transcript_path: sub, last_assistant_message: 'Done in three words',
  });
  assert.equal(subStop.status, 0);
  assert.equal(subStop.stdout, '');
  assert.equal(hookCall('stop', { transcript_path: main }).status, 0);
  // The final message reaches the transcript after Stop; SessionEnd reads it, and the subagent's late lines too.
  writeFileSync(main, line('m1') + line('m1', 300) + line('m2'));
  writeFileSync(sub, line('a1', 50) + line('a2', 70));
  assert.equal(hookCall('session-end', { reason: 'prompt_input_exit', transcript_path: main }).status, 0);

  const d = db();
  const run = d.prepare('SELECT * FROM runs').get();
  assert.equal(run.session_id, 's1');
  assert.equal(run.kind, 'interactive');
  assert.equal(run.status, 'done');
  assert.equal(run.reason, 'prompt_input_exit');
  const usage = d.prepare('SELECT request_id, agent, output FROM usage ORDER BY request_id').all().map((r) => ({ ...r }));
  assert.deepEqual(usage, [
    { request_id: 'a1', agent: 'developer', output: 50 },
    { request_id: 'a2', agent: 'developer', output: 70 },
    { request_id: 'm1', agent: 'main', output: 300 },
    { request_id: 'm2', agent: 'main', output: 100 },
  ]);
  const events = d.prepare('SELECT kind, agent, data FROM events ORDER BY id').all();
  assert.deepEqual(events.map((e) => e.kind), ['session-start', 'subagent-stop', 'stop', 'session-end']);
  for (const e of events) assert.equal(typeof JSON.parse(e.data).ms, 'number');
  assert.equal(JSON.parse(events[1].data).words, 4);
  assert.doesNotMatch(events.map((e) => e.data).join(), /Done in three/);
  d.close();
});

test('a heartbeat or service run is recorded with its kind', () => {
  const { dir, runWithInput, db } = project();
  runWithInput({ CLAUDE_PROJECT_DIR: dir, JEROME_RUN_KIND: 'heartbeat' }, JSON.stringify({ cwd: dir, session_id: 'h1' }), 'hook', 'session-start');
  const d = db();
  assert.equal(d.prepare("SELECT kind FROM runs WHERE session_id = 'h1'").get().kind, 'heartbeat');
  d.close();
});

test('jerome state --replies shows the reply lengths per agent', () => {
  const { run, hookCall } = project();
  hookCall('session-start', {});
  for (const words of [100, 175, 250]) {
    hookCall('subagent-stop', { agent_type: 'developer', last_assistant_message: 'w '.repeat(words) });
  }
  const r = run('state', 'demo', '--replies');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^replies 7d: developer avg 175w max 250 \(2\/3 over 150\)$/m);
  assert.doesNotMatch(run('state', 'demo').stdout, /replies/);
});

test('the pre-tool-use hook refuses a chain with a JSON decision and logs it, and lets the rest through', () => {
  const { hookCall, db } = project();
  hookCall('session-start', {});
  const denied = hookCall('pre-tool-use', { tool_name: 'Bash', tool_input: { command: 'git add -A && git commit -m x' }, agent_type: 'developer' });
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /one per Bash call/);
  for (const payload of [
    { tool_name: 'Bash', tool_input: { command: COMMIT_HEREDOC } },
    { tool_name: 'Bash', tool_input: { command: COMMIT_SUBSHELL } },
    { tool_name: 'Bash', tool_input: { command: 'git status && git diff' } },
    { tool_name: 'Edit', tool_input: { file_path: 'a' } },
  ]) {
    const r = hookCall('pre-tool-use', payload);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
  const d = db();
  const blocked = d.prepare("SELECT agent, data FROM events WHERE kind = 'blocked'").all();
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].agent, 'developer');
  assert.deepEqual(JSON.parse(blocked[0].data).subcommands, ['add', 'commit']);
  assert.doesNotMatch(blocked[0].data, /git add -A/);
  d.close();
});

test('hooks do nothing when Jérôme turns them off for its own checks', () => {
  const { dir, runWithInput, db } = project();
  runWithInput({ CLAUDE_PROJECT_DIR: dir, JEROME_HOOKS: 'off' }, JSON.stringify({ cwd: dir, session_id: 'x' }), 'hook', 'session-start');
  const d = db();
  assert.equal(d.prepare('SELECT count(*) n FROM runs').get().n, 0);
  d.close();
});

test('hooks never fail: outside a project, with bad input or an unknown event', () => {
  const { runWithInput, root } = sandbox();
  assert.equal(runWithInput({}, '{"cwd": "/nowhere"}', 'hook', 'stop').status, 0);
  assert.equal(runWithInput({}, 'not json', 'hook', 'stop').status, 0);
  assert.equal(runWithInput({}, '{}', 'hook', 'whatever').status, 0);
  assert.ok(!existsSync(join(root, '.local', 'share', 'jerome')));
});

test('the status line records the windows only when they change and appends to the personal status line', () => {
  const { root, dir, runWithInput, hookCall, transcripts } = project();
  writeFileSync(join(transcripts, 's1.jsonl'), line('m1'));
  hookCall('stop', { transcript_path: join(transcripts, 's1.jsonl') });
  writeFileSync(join(root, 'claude-config', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo personal' } }));
  const input = JSON.stringify({ cwd: dir, rate_limits: { five_hour: { used_percentage: 43, resets_at: 4102444800 }, seven_day: { used_percentage: 10, resets_at: 4102444800 } } });
  const r = runWithInput({ CLAUDE_PROJECT_DIR: dir }, input, 'statusline');
  assert.equal(r.status, 0, r.stderr);
  // Colours mark how close each figure is to its limit; the text without them:
  assert.match(r.stdout.replace(/\x1b\[[\d;]*m/g, ''), /^personal · 5h 43% · 7d 10% · today <\$0\.01\/\$5 API\n$/);
  assert.match(r.stdout, /\x1b\[32mtoday <\$0\.01\/\$5 API\x1b\[0m/);
  const account = join(root, '.config', 'jerome', 'account.json');
  const first = readFileSync(account, 'utf8');
  runWithInput({ CLAUDE_PROJECT_DIR: dir }, input, 'statusline');
  assert.equal(readFileSync(account, 'utf8'), first, 'an unchanged reading is not written again');
  // A broken input still prints a line and exits with 0.
  assert.equal(runWithInput({}, 'garbage', 'statusline').status, 0);
});

test('doctor adds the hooks next to the project ones, never replaces another status line, and --check fails without them', () => {
  const { run, dir } = project();
  const path = join(dir, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  settings.hooks.Stop = [{ hooks: [{ type: 'command', command: 'say done' }] }];
  settings.statusLine = { type: 'command', command: 'my-line' };
  writeFileSync(path, JSON.stringify(settings));

  const check = run('doctor', 'demo', '--check', '--json');
  assert.equal(check.status, 1);
  const report = JSON.parse(check.stdout);
  assert.deepEqual(report.hooks.pending, ['hook Stop: added']);
  assert.ok(report.warnings.some((w) => w.id === 'statusline'));

  assert.equal(run('doctor', 'demo').status, 0);
  const after = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(after.hooks.Stop.map((g) => g.hooks[0].command), ['say done', 'jerome hook stop']);
  assert.equal(after.statusLine.command, 'my-line');
  assert.match(run('doctor', 'demo').stdout, /✓ Hooks and status line — in place/);
});

test('a background subagent\'s reply is read from its last SubagentHandback', () => {
  const { transcripts, hookCall, db } = project();
  const sub = join(transcripts, 's1', 'subagents', 'agent-b1.jsonl');
  const handbackLine = (message) => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message } }] } })}\n`;
  writeFileSync(sub, line('b1') + handbackLine('first try') + handbackLine('The file has 72 lines.'));
  assert.equal(handback(sub), 'The file has 72 lines.');
  hookCall('subagent-stop', { agent_type: 'analyst', agent_transcript_path: sub, last_assistant_message: '' });
  const d = db();
  assert.equal(JSON.parse(d.prepare("SELECT data FROM events WHERE kind = 'subagent-stop'").get().data).words, 5);
  d.close();
});

test('the session start context carries each open request in full, with the project files it cites', () => {
  const { dir } = project();
  mkdirSync(join(dir, 'notes'), { recursive: true });
  writeFileSync(join(dir, 'notes', 'rigid.md'), '# Rigid fields\n\nOption A: five keys.\n');
  writeFileSync(join(dir, 'notes', 'big.md'), 'x'.repeat(CITED_FILE_CHARS + 1));
  const text = requestsContext(dir, [
    { id: 2, question: 'Which hook fields are rigid? Details in notes/rigid.md.', options: 'A / B', recommendation: 'A' },
    { id: 3, question: 'Read notes/big.md and notes/missing.md', options: null, recommendation: null },
  ]);
  assert.match(text, /without reading other files/);
  assert.match(text, /R2: Which hook fields are rigid\? Details in notes\/rigid\.md\.\nOptions: A \/ B\nRecommendation: A/);
  assert.match(text, /--- notes\/rigid\.md ---\n# Rigid fields\n\nOption A: five keys\.\n--- end of notes\/rigid\.md ---/);
  assert.match(text, /notes\/big\.md \(\d+ characters, not included/);
  assert.doesNotMatch(text, /--- notes\/missing\.md|notes\/missing\.md \(/);
});

test('a stop of Claude Code\'s own helpers, with no agent type, is not counted as a reply', () => {
  const { run, hookCall, db } = project();
  hookCall('session-start', {});
  hookCall('subagent-stop', { agent_type: '', last_assistant_message: 'Rigid hook fields' });
  hookCall('subagent-stop', { agent_type: 'developer', last_assistant_message: 'Done.' });
  const d = db();
  const events = d.prepare("SELECT agent, data FROM events WHERE kind = 'subagent-stop' ORDER BY id").all();
  d.close();
  assert.deepEqual(events.map((e) => [e.agent, JSON.parse(e.data).internal ?? false]), [[null, true], ['developer', false]]);
  assert.match(run('state', 'demo', '--replies').stdout, /^replies 7d: developer avg 1w max 1 \(0\/1 over 150\)$/m);
});

test('a session started by /clear or forked is a new run, with the open requests, and its copied calls are not counted twice', () => {
  const { root, dir, transcripts, hookCall, db } = project();
  const main = join(transcripts, 's1.jsonl');
  writeFileSync(main, line('m1') + line('m2'));
  hookCall('session-start', { source: 'startup', transcript_path: main });
  const write = new DatabaseSync(sandboxDb(root, dir));
  write.prepare("INSERT INTO requests (opened_at, question) VALUES (?, 'Which page next?')").run(new Date().toISOString());
  write.close();
  // /clear ends the session and starts another, with a new session id.
  hookCall('session-end', { reason: 'clear', transcript_path: main });
  const clear = hookCall('session-start', { source: 'clear', session_id: 's2', transcript_path: join(transcripts, 's2.jsonl') });
  assert.match(clear.stdout, /Which page next\?/);
  // A fork gets its own session id and a transcript that starts with the calls of the session it came from.
  const fork = join(transcripts, 's3.jsonl');
  writeFileSync(fork, line('m1') + line('m2') + line('f1'));
  const forked = hookCall('session-start', { source: 'fork', session_id: 's3', transcript_path: fork });
  assert.match(forked.stdout, /Which page next\?/);
  hookCall('session-end', { reason: 'other', session_id: 's3', transcript_path: fork });
  const d = db();
  assert.deepEqual(d.prepare('SELECT session_id, status FROM runs ORDER BY id').all().map((r) => [r.session_id, r.status]), [['s1', 'done'], ['s2', 'running'], ['s3', 'done']]);
  assert.equal(d.prepare('SELECT count(*) n FROM usage').get().n, 3);
  assert.deepEqual(d.prepare("SELECT data FROM events WHERE kind = 'session-start' ORDER BY id").all().map((e) => JSON.parse(e.data).source), ['startup', 'clear', 'fork']);
  d.close();
});
