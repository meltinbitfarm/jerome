// Tests of `jerome new` and `jerome doctor` with a fake `claude` on the PATH: no calls to the real Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './sandbox.js';
import { DENY_RULES, ASK_RULES, ALLOW_RULES, RULE_COUNT } from '../src/limits.js';

test('new creates the project with template, marker, git and lean profile', () => {
  const { root, run } = sandbox();
  const r = run('new', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = join(root, 'demo');
  assert.ok(existsSync(join(dir, '.jerome')));
  assert.ok(existsSync(join(dir, '.git')));
  assert.ok(existsSync(join(dir, '.claude', 'skills', 'project-brief', 'SKILL.md')));
  // The MANIFEST stays in the package: projects don't need it (D38).
  assert.ok(!existsSync(join(dir, 'MANIFEST')));
  assert.ok(existsSync(join(dir, 'CLAUDE.md')));
  assert.doesNotMatch(r.stdout, /budget/);
  for (const devFile of ['PROJECT.md', 'decisions.md', 'open.md', 'PLAN.md', 'package.json']) {
    assert.ok(!existsSync(join(dir, devFile)), `${devFile} must not end up in the project`);
  }
  // The default limits are binding: deny rules in the versioned settings.json (D46).
  const shared = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(shared, { permissions: { deny: DENY_RULES, ask: ASK_RULES, allow: ALLOW_RULES } });
  assert.match(r.stdout, new RegExp(`✓ Default limits — ${RULE_COUNT} permission rules added`));
  // The fake Claude config has no .claude.json, so trust cannot be told and nothing is said about it.
  assert.doesNotMatch(r.stdout, /trust dialog/);
  // The catalog ships inside the project-team skill; the project's agents folder starts empty (D40, D42).
  assert.ok(existsSync(join(dir, '.claude', 'skills', 'project-team', 'agents', 'documentarist.md')));
  assert.ok(existsSync(join(dir, '.claude', 'skills', 'docs', 'SKILL.md')));
  assert.ok(!existsSync(join(dir, '.claude', 'agents')));
  // The profile depends on the machine: it goes in the local settings, which git ignores (D21).
  assert.equal(shared.enabledPlugins, undefined);
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepEqual(settings.enabledPlugins, { 'shop@official': false, 'sito@synced': false });
  assert.equal(settings.skillOverrides['anthropic-skills:docx'], 'off');
  // plugin-authoring is not among the known sources: the /context check finds it and turns it off.
  assert.equal(settings.skillOverrides['plugin-authoring'], 'off');
  assert.match(r.stdout, /project skills: docs, project-brief, project-team/);
  const ignored = spawnSync('git', ['check-ignore', '.claude/settings.local.json'], { cwd: dir });
  assert.equal(ignored.status, 0, 'git must ignore the local settings');
});

test('new on an existing folder changes nothing', () => {
  const { root, run } = sandbox();
  mkdirSync(join(root, 'existing'));
  writeFileSync(join(root, 'existing', 'mine.txt'), 'hello');
  const r = run('new', 'existing');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists/);
  assert.deepEqual(readdirSync(join(root, 'existing')), ['mine.txt']);
});

test('new without a login stops and creates no folder', () => {
  const { root, run } = sandbox({ loggedIn: false });
  const r = run('new', 'demo');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ Logged in with a subscription — not logged in/);
  assert.ok(!existsSync(join(root, 'demo')));
});

test('new without Claude Code stops and creates no folder', () => {
  const { root, run } = sandbox({ withClaude: false });
  const r = run('new', 'demo');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ Claude Code installed — Claude Code is not installed/);
  assert.ok(!existsSync(join(root, 'demo')));
});

test('doctor restores the profile after a new plugin and keeps the other keys', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const path = join(root, 'demo', '.claude', 'settings.local.json');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  delete settings.enabledPlugins['shop@official'];
  settings.permissions = { allow: ['Bash(ls)'] };
  writeFileSync(path, JSON.stringify(settings));

  const r = run('doctor', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /enabledPlugins\.shop@official = false/);
  const after = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(after.enabledPlugins['shop@official'], false);
  assert.deepEqual(after.permissions, { allow: ['Bash(ls)'] });
  assert.match(run('doctor', 'demo').stdout, /Lean profile already in place/);
});

test('doctor moves a profile left in settings.json to the local settings', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const claudeDir = join(root, 'demo', '.claude');
  // A project created before D21 was corrected: the profile sits in the shared settings, next to a team setting.
  const profile = JSON.parse(readFileSync(join(claudeDir, 'settings.local.json'), 'utf8'));
  writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ ...profile, permissions: { allow: ['Bash(ls)'] } }));
  rmSync(join(claudeDir, 'settings.local.json'));

  const r = run('doctor', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /moved \d+ profile entries from settings\.json to settings\.local\.json/);
  assert.deepEqual(JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8')), { permissions: { allow: ['Bash(ls)', ...ALLOW_RULES], deny: DENY_RULES, ask: ASK_RULES } });
  assert.deepEqual(JSON.parse(readFileSync(join(claudeDir, 'settings.local.json'), 'utf8')), profile);
  assert.match(run('doctor', 'demo').stdout, /Lean profile already in place/);
});

test('doctor warns, without failing, when the files loaded every session are over budget', () => {
  const { root, run } = sandbox({ env: { FAKE_CLAUDE_MD_TOKENS: '700' } });
  assert.equal(run('new', 'demo').status, 0);
  writeFileSync(join(root, 'demo', 'PROJECT.md'), '# Demo\n');
  const r = run('doctor', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /! CLAUDE\.md: 700 tokens, over its 680-token budget/);
  assert.match(r.stdout, /! PROJECT\.md: 1100 tokens, over its 800-token budget/);
});

test('a project can raise its budgets in .jerome, and bad entries only warn', () => {
  const { root, run } = sandbox({ env: { FAKE_CLAUDE_MD_TOKENS: '700' } });
  assert.equal(run('new', 'demo').status, 0);
  const dir = join(root, 'demo');
  writeFileSync(join(dir, 'PROJECT.md'), '# Demo\n');
  const marker = JSON.parse(readFileSync(join(dir, '.jerome'), 'utf8'));
  writeFileSync(join(dir, '.jerome'), JSON.stringify({ ...marker, budgets: { 'PROJECT.md': 1200, 'CLAUDE.md': -1, 'open.md': 300 } }));
  const r = run('doctor', 'demo', '--check', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const warnings = JSON.parse(r.stdout).warnings;
  assert.deepEqual(warnings.filter((w) => w.id === 'budget').map((w) => [w.file, w.budget]), [['CLAUDE.md', 680]]);
  assert.deepEqual(warnings.filter((w) => w.id === 'budgets-config').length, 2);
  // jerome update rewrites .jerome but keeps the budgets.
  run('update', 'demo', '--yes');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.jerome'), 'utf8')).budgets['PROJECT.md'], 1200);
});

test('doctor fails if a plugin skill stays loaded', () => {
  const { root, run } = sandbox({ env: { FAKE_STUCK_PLUGIN: '1' } });
  assert.equal(run('new', 'demo').status, 1);
  const r = run('doctor', 'demo');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ skill still loaded: shop:x \(Plugin \(shop\)\)/);
});

test('doctor outside a Jérôme project', () => {
  const { run } = sandbox();
  const r = run('doctor');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not a Jérôme project/);
});

for (const [variant, problem] of [
  ['renamed', /section "Skills" is missing/],
  ['header', /section "Skills" has table header "Name \| Origin \| Tokens"/],
  ['source', /unknown skill source label\(s\): "Workspace"/],
]) {
  test(`doctor fails when /context changes: ${variant}`, () => {
    const { run, runWith } = sandbox();
    assert.equal(run('new', 'demo').status, 0);
    const r = runWith({ FAKE_CONTEXT: variant }, 'doctor', 'demo');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /✗ Claude Code's \/context output was not recognized/);
    assert.match(r.stdout, problem);
    assert.doesNotMatch(r.stdout, /✓ Startup context/);
  });
}

test('doctor --json: schema, checks, sections, counts and warnings, with a matching exit code', () => {
  const { run } = sandbox({ env: { FAKE_CLAUDE_MD_TOKENS: '700' } });
  assert.equal(run('new', 'demo').status, 0);
  const r = run('doctor', 'demo', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.schema, 'jerome.doctor/v1');
  assert.equal(report.mode, 'fix');
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks.map((c) => c.id),
    ['project', 'limits', 'node', 'git', 'claude-code', 'login', 'profile', 'context-format', 'startup-context']);
  assert.ok(report.checks.every((c) => c.ok));
  assert.deepEqual(report.context.sections, {
    'Estimated usage by category': { found: true, rows: 1 },
    Skills: { found: true, rows: 3 },
    'Memory Files': { found: true, rows: 1 },
  });
  assert.deepEqual(report.context.counts, { categories: 1, skills: 3, projectSkills: 3, memoryFiles: 1 });
  assert.deepEqual(report.limits, { added: [], missing: [] });
  assert.equal(report.context.totalTokens, 12100);
  assert.deepEqual(report.warnings.map((w) => [w.id, w.file, w.tokens, w.budget]), [['budget', 'CLAUDE.md', 700, 680]]);
});

test('doctor --json reports a broken /context with ok false and exit code 1', () => {
  const { run, runWith } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const r = runWith({ FAKE_CONTEXT: 'renamed' }, 'doctor', 'demo', '--json');
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, false);
  const check = report.checks.find((c) => c.id === 'context-format');
  assert.equal(check.ok, false);
  assert.match(check.problems.join('\n'), /section "Skills" is missing/);
  assert.equal(report.context.sections.Skills.found, false);
});

test('doctor --json outside a Jérôme project', () => {
  const { run } = sandbox();
  const r = run('doctor', '--json');
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.map((c) => [c.id, c.ok]), [['project', false]]);
});

test('--json is refused for jerome new', () => {
  const { run } = sandbox();
  const r = run('new', 'demo', '--json');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--json not available for jerome new/);
});

// Every file of a project except git's internals, with its content and modification time.
function snapshot(dir) {
  const files = {};
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) walk(path);
      else files[path.slice(dir.length)] = [readFileSync(path, 'utf8'), statSync(path).mtimeMs];
    }
  };
  walk(dir);
  return files;
}

// Leaves the profile in need of every kind of fix: a missing plugin entry, entries left in settings.json
// by an earlier version, and .gitignore without the local settings.
function unsettle(dir) {
  const local = join(dir, '.claude', 'settings.local.json');
  const settings = JSON.parse(readFileSync(local, 'utf8'));
  delete settings.enabledPlugins['shop@official'];
  delete settings.skillOverrides['anthropic-skills:docx'];
  writeFileSync(local, JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { 'anthropic-skills:docx': 'off' }, permissions: { allow: ['Bash(ls)'] } }));
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
}

test('doctor --check on a lean project passes and writes nothing', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const dir = join(root, 'demo');
  const before = snapshot(dir);
  const r = run('doctor', 'demo', '--check');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ Lean profile already in place/);
  assert.deepEqual(snapshot(dir), before);
});

test('doctor --check reports the needed changes, fails, and writes nothing', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const dir = join(root, 'demo');
  unsettle(dir);
  const before = snapshot(dir);

  const r = run('doctor', 'demo', '--check');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /✗ Lean profile — 3 changes needed: run `jerome doctor` to apply them/);
  assert.match(r.stdout, /\.gitignore: added \.claude\/settings\.local\.json/);
  assert.match(r.stdout, /moved 1 profile entries from settings\.json to settings\.local\.json/);
  assert.match(r.stdout, /enabledPlugins\.shop@official = false/);
  assert.deepEqual(snapshot(dir), before);

  // The same changes are real: the plain command applies them, and then --check passes.
  assert.equal(run('doctor', 'demo').status, 0);
  assert.notDeepEqual(snapshot(dir), before);
  assert.equal(run('doctor', 'demo', '--check').status, 0);
});

test('doctor --check --json lists pending changes, matches the exit code, and writes nothing', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'demo').status, 0);
  const dir = join(root, 'demo');
  unsettle(dir);
  const before = snapshot(dir);

  const r = run('doctor', 'demo', '--check', '--json');
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.mode, 'check');
  assert.equal(report.ok, false);
  assert.deepEqual(report.profile.changes, []);
  assert.equal(report.profile.pending.length, 3);
  assert.equal(report.checks.find((c) => c.id === 'profile').ok, false);
  assert.deepEqual(snapshot(dir), before);
});
