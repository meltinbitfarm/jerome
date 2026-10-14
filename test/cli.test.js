// Tests of `jerome new` and `jerome doctor` with a fake `claude` on the PATH: no calls to the real Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dirname, '..', 'bin', 'jerome.js');

// The fake claude reads its state from environment variables and, for /context, from the folder's settings files,
// shared and local, like the real one.
const FAKE_CLAUDE = `#!/bin/sh
case "$1" in
  --version) echo "9.9.9 (Claude Code)";;
  auth)
    if [ "$FAKE_LOGGED_IN" = "1" ]; then
      echo '{"loggedIn": true, "authMethod": "claude.ai", "email": "test@example.com"}'
    else
      echo '{"loggedIn": false, "authMethod": "none"}'; exit 1
    fi;;
  plugin) echo '[{"id": "shop@official"}, {"id": "sito@synced"}]';;
  -p)
    S="$(cat .claude/settings.json .claude/settings.local.json 2>/dev/null)"
    echo "## Context Usage"; echo; echo "**Tokens:** 12.1k / 1m (1%)"; echo
    echo "### Estimated usage by category"; echo; echo "| Category | Tokens | Percentage |"; echo "|---|---|---|"
    echo "| System prompt | 2.4k | 0.2% |"
    echo "$S" | grep -q '"disableClaudeAiConnectors": true' || echo "| MCP tools | 615 | 0.1% |"
    # FAKE_CONTEXT breaks the format on purpose: renamed section, different table header, unknown source label.
    if [ "$FAKE_CONTEXT" = "renamed" ]; then echo; echo "### Skill list"; else echo; echo "### Skills"; fi
    if [ "$FAKE_CONTEXT" = "header" ]; then echo; echo "| Name | Origin | Tokens |"; else echo; echo "| Skill | Source | Tokens |"; fi
    echo "|---|---|---|"
    [ "$FAKE_CONTEXT" = "source" ] && echo "| team-skill | Workspace | ~50 |"
    for s in .claude/skills/*/; do [ -d "$s" ] && echo "| $(basename $s) | Project | ~200 |"; done
    echo "$S" | grep -q '"anthropic-skills:docx": "off"' || echo "| docx | claude.ai sync | ~320 |"
    echo "$S" | grep -q '"plugin-authoring": "off"' || echo "| plugin-authoring | Built-in | ~90 |"
    [ "$FAKE_STUCK_PLUGIN" = "1" ] && echo "| shop:x | Plugin (shop) | ~40 |"
    echo; echo "### Memory Files"; echo; echo "| Type | Path | Tokens |"; echo "|---|---|---|"
    [ -f CLAUDE.md ] && echo "| Project | $(pwd -P)/CLAUDE.md | \${FAKE_CLAUDE_MD_TOKENS:-496} |"
    [ -f PROJECT.md ] && echo "| Project | $(pwd -P)/PROJECT.md | 1.1k |"
    exit 0;;
esac
`;

function sandbox({ loggedIn = true, withClaude = true, env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jerome-test-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  if (withClaude) {
    writeFileSync(join(bin, 'claude'), FAKE_CLAUDE);
    chmodSync(join(bin, 'claude'), 0o755);
  }
  const config = join(root, 'claude-config');
  mkdirSync(join(config, 'skills', 'synced', 'acct', 'docx'), { recursive: true });
  writeFileSync(join(config, 'skills', 'synced', 'acct', 'docx', 'SKILL.md'), '');
  // runWith adds environment variables for one call, e.g. a broken /context on an existing project.
  const runWith = (extra, ...args) => spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: root,
      CLAUDE_CONFIG_DIR: config,
      FAKE_LOGGED_IN: loggedIn ? '1' : '0',
      GIT_CONFIG_NOSYSTEM: '1',
      ...env,
      ...extra,
    },
  });
  const run = (...args) => runWith({}, ...args);
  return { root, run, runWith };
}

test('new creates the project with template, marker, git and lean profile', () => {
  const { root, run } = sandbox();
  const r = run('new', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = join(root, 'demo');
  assert.ok(existsSync(join(dir, '.jerome')));
  assert.ok(existsSync(join(dir, '.git')));
  assert.ok(existsSync(join(dir, '.claude', 'skills', 'project-brief', 'SKILL.md')));
  assert.ok(existsSync(join(dir, 'MANIFEST')));
  assert.ok(existsSync(join(dir, 'CLAUDE.md')));
  assert.doesNotMatch(r.stdout, /budget/);
  for (const devFile of ['PROJECT.md', 'decisions.md', 'open.md', 'PLAN.md', 'package.json']) {
    assert.ok(!existsSync(join(dir, devFile)), `${devFile} must not end up in the project`);
  }
  // The profile depends on the machine: it goes in the local settings, which git ignores (D21).
  assert.ok(!existsSync(join(dir, '.claude', 'settings.json')));
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepEqual(settings.enabledPlugins, { 'shop@official': false, 'sito@synced': false });
  assert.equal(settings.skillOverrides['anthropic-skills:docx'], 'off');
  // plugin-authoring is not among the known sources: the /context check finds it and turns it off.
  assert.equal(settings.skillOverrides['plugin-authoring'], 'off');
  assert.match(r.stdout, /project skills: project-brief/);
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
  assert.deepEqual(JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8')), { permissions: { allow: ['Bash(ls)'] } });
  assert.deepEqual(JSON.parse(readFileSync(join(claudeDir, 'settings.local.json'), 'utf8')), profile);
  assert.match(run('doctor', 'demo').stdout, /Lean profile already in place/);
});

test('doctor warns, without failing, when the files loaded every session are over budget', () => {
  const { root, run } = sandbox({ env: { FAKE_CLAUDE_MD_TOKENS: '620' } });
  assert.equal(run('new', 'demo').status, 0);
  writeFileSync(join(root, 'demo', 'PROJECT.md'), '# Demo\n');
  const r = run('doctor', 'demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /! CLAUDE\.md: 620 tokens, over its 600-token budget/);
  assert.match(r.stdout, /! PROJECT\.md: 1100 tokens, over its 800-token budget/);
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
  const { run } = sandbox({ env: { FAKE_CLAUDE_MD_TOKENS: '620' } });
  assert.equal(run('new', 'demo').status, 0);
  const r = run('doctor', 'demo', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.schema, 'jerome.doctor/v1');
  assert.equal(report.mode, 'fix');
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks.map((c) => c.id),
    ['project', 'node', 'git', 'claude-code', 'login', 'profile', 'context-format', 'startup-context']);
  assert.ok(report.checks.every((c) => c.ok));
  assert.deepEqual(report.context.sections, {
    'Estimated usage by category': { found: true, rows: 1 },
    Skills: { found: true, rows: 1 },
    'Memory Files': { found: true, rows: 1 },
  });
  assert.deepEqual(report.context.counts, { categories: 1, skills: 1, projectSkills: 1, memoryFiles: 1 });
  assert.equal(report.context.totalTokens, 12100);
  assert.deepEqual(report.warnings.map((w) => [w.id, w.file, w.tokens, w.budget]), [['budget', 'CLAUDE.md', 620, 600]]);
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
  assert.match(r.stderr, /only available for jerome doctor/);
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
