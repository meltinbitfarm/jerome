// Tests of `jerome new` and `jerome doctor` with a fake `claude` on the PATH: no calls to the real Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dirname, '..', 'bin', 'jerome.js');

// The fake claude reads its state from environment variables and, for /context, from the folder's settings.json.
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
    S=.claude/settings.json
    echo "## Context Usage"; echo; echo "**Tokens:** 12.1k / 1m (1%)"; echo
    echo "### Estimated usage by category"; echo; echo "| Category | Tokens | Percentage |"; echo "|---|---|---|"
    echo "| System prompt | 2.4k | 0.2% |"
    grep -q '"disableClaudeAiConnectors": true' $S 2>/dev/null || echo "| MCP tools | 615 | 0.1% |"
    echo; echo "### Skills"; echo; echo "| Skill | Source | Tokens |"; echo "|---|---|---|"
    for s in .claude/skills/*/; do [ -d "$s" ] && echo "| $(basename $s) | Project | ~200 |"; done
    grep -q '"anthropic-skills:docx": "off"' $S 2>/dev/null || echo "| docx | claude.ai sync | ~320 |"
    grep -q '"plugin-authoring": "off"' $S 2>/dev/null || echo "| plugin-authoring | Built-in | ~90 |"
    [ "$FAKE_STUCK_PLUGIN" = "1" ] && echo "| shop:x | Plugin (shop) | ~40 |"
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
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: root,
      CLAUDE_CONFIG_DIR: config,
      FAKE_LOGGED_IN: loggedIn ? '1' : '0',
      GIT_CONFIG_NOSYSTEM: '1',
      ...env,
    },
  });
  return { root, run };
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
  for (const devFile of ['PROJECT.md', 'decisions.md', 'open.md', 'PLAN.md', 'package.json']) {
    assert.ok(!existsSync(join(dir, devFile)), `${devFile} must not end up in the project`);
  }
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.enabledPlugins, { 'shop@official': false, 'sito@synced': false });
  assert.equal(settings.skillOverrides['anthropic-skills:docx'], 'off');
  // plugin-authoring is not among the known sources: the /context check finds it and turns it off.
  assert.equal(settings.skillOverrides['plugin-authoring'], 'off');
  assert.match(r.stdout, /project skills: project-brief/);
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
  const path = join(root, 'demo', '.claude', 'settings.json');
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
