// Tests of the phase 4 rules: binding default limits, the project's agents, the documentation queue and
// `jerome docs`, with a fake `claude` on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './sandbox.js';
import { DENY_RULES } from '../src/limits.js';

const AGENT = (meta) => `---\nname: x\ndescription: X.\n${meta}\n---\nDo x.\n`;

test('doctor --check fails on a missing deny rule, and doctor puts it back keeping the project rules', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const path = join(root, 'demo', '.claude', 'settings.json');
  writeFileSync(path, JSON.stringify({ permissions: { deny: ['Bash(rm -rf *)', ...DENY_RULES.slice(1)] }, model: 'opus' }));

  const check = run('doctor', 'demo', '--check', '--json');
  assert.equal(check.status, 1);
  const report = JSON.parse(check.stdout);
  assert.deepEqual(report.limits.missing, [DENY_RULES[0]]);
  assert.equal(report.checks.find((c) => c.id === 'limits').ok, false);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).permissions.deny.length, DENY_RULES.length);

  const fix = run('doctor', 'demo');
  assert.equal(fix.status, 0, fix.stdout + fix.stderr);
  assert.match(fix.stdout, /✓ Default limits — 1 deny rule added/);
  const after = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(after.model, 'opus');
  assert.deepEqual(after.permissions.deny, ['Bash(rm -rf *)', ...DENY_RULES.slice(1), DENY_RULES[0]]);
});

test('doctor warns about agents without a model or loading CLAUDE.md, without failing', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const agents = join(root, 'demo', '.claude', 'agents');
  mkdirSync(agents);
  writeFileSync(join(agents, 'good.md'), AGENT('model: sonnet\nomitClaudeMd: true'));
  writeFileSync(join(agents, 'loose.md'), AGENT('tools: Read'));
  writeFileSync(join(agents, 'inherits.md'), AGENT('model: inherit\nomitClaudeMd: true'));
  const r = run('doctor', 'demo', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const warnings = JSON.parse(r.stdout).warnings.filter((w) => w.id === 'agents');
  assert.deepEqual(warnings.map((w) => [w.file, w.problems.length]), [
    ['.claude/agents/inherits.md', 1],
    ['.claude/agents/loose.md', 2],
  ]);
});

test('doctor warns when the documentation queue holds more than 20 entries', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  mkdirSync(join(root, 'demo', 'docs'));
  const queue = join(root, 'demo', 'docs', '_pending.md');
  const lines = (n) => Array.from({ length: n }, (_, i) => `- 2026-10-15 · developer · a.js · change ${i}`).join('\n');
  writeFileSync(queue, `# Pending\n\n${lines(20)}\n`);
  assert.doesNotMatch(run('doctor', 'demo').stdout, /_pending/);
  writeFileSync(queue, `# Pending\n\n${lines(21)}\n`);
  const r = run('doctor', 'demo');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /! docs\/_pending\.md holds 21 entries, over 20/);
});

test('jerome update never touches the project agents or settings.json', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const dir = join(root, 'demo');
  mkdirSync(join(dir, '.claude', 'agents'));
  const own = AGENT('model: sonnet\nomitClaudeMd: true');
  writeFileSync(join(dir, '.claude', 'agents', 'documentarist.md'), own);
  const r = run('update', 'demo', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(dir, '.claude', 'agents', 'documentarist.md'), 'utf8'), own);
  assert.doesNotMatch(r.stdout, /agents|settings\.json/);
});

test('jerome docs with an empty queue does not call Claude Code', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const r = run('docs', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /has no entries/);
  assert.ok(!existsSync(join(root, 'service-args')));
});

test('jerome docs runs the documentarist as a service call, outside the project', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const dir = realpathSync(join(root, 'demo'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', '_pending.md'), '- 2026-10-15 · developer · a.js · added a\n- 2026-10-15 · developer · b.js · added b\n');

  const r = run('docs', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Documentarist \(haiku, from the catalog\) on 2 entries/);
  assert.match(r.stdout, /✓ docs\/_pending\.md: 2 of 2 entries integrated/);
  const cwd = readFileSync(join(root, 'service-cwd'), 'utf8').trim();
  assert.ok(!cwd.startsWith(dir), 'the call must not start from the project');
  assert.ok(!existsSync(cwd), 'the service folder is emptied');
  const args = readFileSync(join(root, 'service-args'), 'utf8').split('\n');
  for (const expected of ['--no-session-persistence', '--add-dir', dir, '--settings', join(dir, '.claude', 'settings.local.json'), `Edit(/${dir}/docs/**)`]) {
    assert.ok(args.includes(expected), `missing ${expected}`);
  }
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.equal(JSON.parse(args[args.indexOf('--agents') + 1]).documentarist.model, 'haiku');

  // The project's own documentarist wins over the catalog's, with its model.
  mkdirSync(join(dir, '.claude', 'agents'));
  writeFileSync(join(dir, '.claude', 'agents', 'documentarist.md'), AGENT('model: sonnet\nomitClaudeMd: true'));
  writeFileSync(join(dir, 'docs', '_pending.md'), '- 2026-10-15 · developer · a.js · added a\n');
  const own = run('docs', 'demo');
  assert.match(own.stdout, /Documentarist \(sonnet\) on 1 entry/);
});
