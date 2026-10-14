// Prove di `jerome new` e `jerome doctor` con un `claude` finto nel PATH: niente chiamate al vero Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dirname, '..', 'bin', 'jerome.js');

// Il finto claude legge lo stato da variabili d'ambiente e, per /context, dal settings.json della cartella.
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

test('new crea il progetto con template, marcatore, git e profilo snello', () => {
  const { root, run } = sandbox();
  const r = run('new', 'prova');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = join(root, 'prova');
  assert.ok(existsSync(join(dir, '.jerome')));
  assert.ok(existsSync(join(dir, '.git')));
  assert.ok(existsSync(join(dir, '.claude', 'skills', 'project-brief', 'SKILL.md')));
  assert.ok(existsSync(join(dir, 'MANIFEST')));
  for (const devFile of ['PROJECT.md', 'decisions.md', 'open.md', 'PLAN.md', 'package.json']) {
    assert.ok(!existsSync(join(dir, devFile)), `${devFile} non deve finire nel progetto`);
  }
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.enabledPlugins, { 'shop@official': false, 'sito@synced': false });
  assert.equal(settings.skillOverrides['anthropic-skills:docx'], 'off');
  // plugin-authoring non è tra le fonti note: lo trova la verifica con /context e lo spegne.
  assert.equal(settings.skillOverrides['plugin-authoring'], 'off');
  assert.match(r.stdout, /project skills: project-brief/);
});

test('new su una cartella esistente non tocca nulla', () => {
  const { root, run } = sandbox();
  mkdirSync(join(root, 'esiste'));
  writeFileSync(join(root, 'esiste', 'mio.txt'), 'ciao');
  const r = run('new', 'esiste');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists/);
  assert.deepEqual(readdirSync(join(root, 'esiste')), ['mio.txt']);
});

test('new senza login si ferma e non crea la cartella', () => {
  const { root, run } = sandbox({ loggedIn: false });
  const r = run('new', 'prova');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ Logged in with a subscription — not logged in/);
  assert.ok(!existsSync(join(root, 'prova')));
});

test('new senza Claude Code si ferma e non crea la cartella', () => {
  const { root, run } = sandbox({ withClaude: false });
  const r = run('new', 'prova');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ Claude Code installed — Claude Code is not installed/);
  assert.ok(!existsSync(join(root, 'prova')));
});

test('doctor rimette il profilo dopo un plugin nuovo e lascia le altre chiavi', () => {
  const { root, run } = sandbox();
  assert.equal(run('new', 'prova').status, 0);
  const path = join(root, 'prova', '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  delete settings.enabledPlugins['shop@official'];
  settings.permissions = { allow: ['Bash(ls)'] };
  writeFileSync(path, JSON.stringify(settings));

  const r = run('doctor', 'prova');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /enabledPlugins\.shop@official = false/);
  const after = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(after.enabledPlugins['shop@official'], false);
  assert.deepEqual(after.permissions, { allow: ['Bash(ls)'] });
  assert.match(run('doctor', 'prova').stdout, /Lean profile already in place/);
});

test('doctor fallisce se una skill di plugin resta caricata', () => {
  const { root, run } = sandbox({ env: { FAKE_STUCK_PLUGIN: '1' } });
  assert.equal(run('new', 'prova').status, 1);
  const r = run('doctor', 'prova');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ skill still loaded: shop:x \(Plugin \(shop\)\)/);
});

test('doctor fuori da un progetto Jérôme', () => {
  const { run } = sandbox();
  const r = run('doctor');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not a Jérôme project/);
});
