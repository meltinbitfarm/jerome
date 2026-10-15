// A sandbox for running the CLI with a fake `claude` on the PATH: no calls to the real Claude Code.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
    # A service call (jerome docs): record where it ran and with which arguments, then empty the queue it was given.
    case " $* " in *" --agent "*)
      pwd -P > "$HOME/service-cwd"; printf '%s\n' "$@" > "$HOME/service-args"
      while [ "$#" -gt 0 ]; do [ "$1" = "--add-dir" ] && : > "$2/docs/_pending.md"; shift; done
      echo '{"type": "result", "is_error": false, "result": "Integrated the entries."}'; exit 0;;
    esac
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

export function sandbox({ loggedIn = true, withClaude = true, env = {} } = {}) {
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
  const call = (extra, input, args) => spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    input,
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
  const runWith = (extra, ...args) => call(extra, '', args);
  const run = (...args) => call({}, '', args);
  // runInput passes text on standard input, e.g. a brief for `--from-file -`.
  const runInput = (input, ...args) => call({}, input, args);
  return { root, run, runWith, runInput };
}
