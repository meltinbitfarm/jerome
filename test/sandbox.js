// A sandbox for running the CLI with a fake `claude` on the PATH: no calls to the real Claude Code.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneRoot, storeKey } from '../src/store.js';

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
    echo "$*" >> "$HOME/claude-calls.log"
    # A service call (jerome docs): record where it ran and with which arguments, then empty the queue it was given.
    case " $* " in *" --agent "*)
      pwd -P > "$HOME/service-cwd"; printf '%s\n' "$@" > "$HOME/service-args"
      while [ "$#" -gt 0 ]; do [ "$1" = "--add-dir" ] && : > "$2/.jerome/docs-queue.md"; shift; done
      echo '{"type": "result", "is_error": false, "result": "Integrated the entries."}'; exit 0;;
    esac
    # The boards' plain texts (D177): each item given back as "plain: <text>", or FAKE_PLAIN_FAIL to fail.
    case " $* " in *"You rewrite the work notes"*)
      [ -n "$FAKE_PLAIN_FAIL" ] && { echo "plain failed" >&2; exit 1; }
      echo x >> "$HOME/plain-calls.log"
      "$FAKE_NODE" -e 'const p = process.argv.find((a) => a.includes("Items:\\n")); const items = JSON.parse(p.split("Items:\\n")[1]); console.log(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(Object.fromEntries(Object.entries(items).map(([k, t]) => [k, "plain: " + t]))) }))' -- "$@"
      exit 0;;
    esac
    # A heartbeat's triage: no tools, on Haiku, streamed. FAKE_TRIAGE is the JSON verdict it gives; FAKE_TRIAGE_WINDOW,
    # a 5-hour utilization such as 0.33, adds a rate_limit_event before the result.
    case " $* " in *" --model haiku "*)
      [ -n "$FAKE_TRIAGE_WINDOW" ] && echo "{\\"type\\":\\"rate_limit_event\\",\\"rate_limit_info\\":{\\"unifiedWindows\\":{\\"five_hour\\":{\\"utilization\\":$FAKE_TRIAGE_WINDOW,\\"resetsAt\\":4102444800}}}}"
      "$FAKE_NODE" -e 'console.log(JSON.stringify({ type: "result", is_error: false, result: process.env.FAKE_TRIAGE || JSON.stringify({ work: false, reason: "nothing to do" }), modelUsage: { "claude-haiku-5-5": { inputTokens: 3000, outputTokens: 40, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } }))'
      exit 0;;
    esac
    # A heartbeat's lead agent: it streams FAKE_LEAD_CALLS calls of FAKE_LEAD_TOKENS tokens each, writes them to its
    # transcript, may open a decision request, and ends with FAKE_LEAD_RESULT.
    case " $* " in *" --max-turns "*)
      sid=""; prev=""; for a in "$@"; do [ "$prev" = "--session-id" ] && sid="$a"; prev="$a"; done
      t="$CLAUDE_CONFIG_DIR/projects/-fake/$sid.jsonl"; mkdir -p "$(dirname "$t")"
      # FAKE_LEAD_BRANCH: it works on a branch, with a commit (FAKE_LEAD_COMMIT) or uncommitted changes (FAKE_LEAD_DIRTY).
      [ -n "$FAKE_LEAD_BRANCH" ] && git switch -q -c "$FAKE_LEAD_BRANCH"
      [ -n "$FAKE_LEAD_COMMIT" ] && echo x > fake.txt && git add fake.txt && git -c user.email=t@example.com -c user.name=t commit -q -m wip
      [ -n "$FAKE_LEAD_DIRTY" ] && echo y > dirty.txt
      # What the runner gives it (D120), and a process it leaves running in the background (FAKE_LEAD_GRANDCHILD).
      echo "ceiling=$CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS kind=$JEROME_RUN_KIND" > "$HOME/lead-env"
      printf '%s' "$2" > "$HOME/lead-prompt"
      [ -n "$FAKE_LEAD_GRANDCHILD" ] && { sleep 60 & echo $! > "$HOME/grandchild.pid"; }
      # FAKE_LEAD_FINISH: it finishes the work it finds (RESUME): commits what is left on its branch, merges it into main.
      if [ -n "$FAKE_LEAD_FINISH" ]; then
        b="$(git rev-parse --abbrev-ref HEAD)"
        git add -A . ':!.jerome/digest.md' 2>/dev/null; git -c user.email=t@example.com -c user.name=t commit -q -m finish 2>/dev/null
        if [ "$b" != main ]; then git switch -q main && git -c user.email=t@example.com -c user.name=t merge -q --no-ff -m merge "$b" && git branch -q -d "$b"; fi
      fi
      i=1; while [ "$i" -le "\${FAKE_LEAD_CALLS:-2}" ]; do
        u="{\\"input_tokens\\":10,\\"output_tokens\\":90,\\"cache_read_input_tokens\\":0,\\"cache_creation_input_tokens\\":$(( \${FAKE_LEAD_TOKENS:-1000} - 100 ))}"
        echo "{\\"type\\":\\"assistant\\",\\"message\\":{\\"id\\":\\"m$i\\",\\"usage\\":$u}}"
        echo "{\\"type\\":\\"assistant\\",\\"requestId\\":\\"req-$sid-$i\\",\\"timestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\",\\"message\\":{\\"model\\":\\"claude-opus-5-5\\",\\"usage\\":$u}}" >> "$t"
        # FAKE_SUB_TOKENS: a researcher subagent works alongside, in its own transcript only, never in the stream.
        if [ -n "$FAKE_SUB_TOKENS" ]; then
          sd="$(dirname "$t")/$sid/subagents"; mkdir -p "$sd"
          echo '{"agentType":"researcher","requestShape":"foreground"}' > "$sd/agent-s1.meta.json"
          echo "{\\"type\\":\\"assistant\\",\\"requestId\\":\\"sub-$sid-$i\\",\\"timestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\",\\"message\\":{\\"model\\":\\"claude-sonnet-5-5\\",\\"usage\\":{\\"input_tokens\\":0,\\"output_tokens\\":0,\\"cache_creation_input_tokens\\":$FAKE_SUB_TOKENS}}}" >> "$sd/agent-s1.jsonl"
        fi
        [ -n "$FAKE_LEAD_SLEEP" ] && sleep "$FAKE_LEAD_SLEEP"
        i=$((i + 1))
      done
      # Its line in the digest (D120), unless FAKE_LEAD_NO_DIGEST.
      if [ -z "$FAKE_LEAD_NO_DIGEST" ] && [ "\${FAKE_LEAD_RESULT:-success}" = success ]; then
        echo "- $(date +'%Y-%m-%d %H:%M') · fake work" >> .jerome/digest.md
        git add .jerome/digest.md && git -c user.email=t@example.com -c user.name=t commit -q -m digest
      fi
      echo '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.42,"resetsAt":4102444800},"seven_day":{"utilization":0.1,"resetsAt":4102444800}}}}'
      # FAKE_LEAD_DENIED: a Bash command it was refused (or the tool FAKE_LEAD_DENIED_TOOL), as Claude Code streams it, by FAKE_LEAD_DENIED_TYPE (mode).
      [ -n "$FAKE_LEAD_DENIED" ] && "$FAKE_NODE" -e 'const c = process.env.FAKE_LEAD_DENIED; const n = process.env.FAKE_LEAD_DENIED_TOOL || "Bash"; console.log(JSON.stringify({ type: "assistant", message: { id: "md", content: [{ type: "tool_use", id: "tu1", name: n, input: n === "Bash" ? { command: c } : {} }] } })); console.log(JSON.stringify({ type: "system", subtype: "permission_denied", tool_name: n, tool_use_id: "tu1", decision_reason_type: process.env.FAKE_LEAD_DENIED_TYPE || "mode", message: "denied" }))'
      [ -n "$FAKE_LEAD_REQUEST" ] && "$FAKE_NODE" "$JEROME_BIN" request open --question "$FAKE_LEAD_REQUEST" \${FAKE_LEAD_MILESTONE:+--milestone} > /dev/null
      echo "{\\"type\\":\\"result\\",\\"subtype\\":\\"\${FAKE_LEAD_RESULT:-success}\\",\\"is_error\\":$([ "\${FAKE_LEAD_RESULT:-success}" = success ] && echo false || echo true),\\"result\\":\\"done\\"}"
      exit 0;;
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
    [ -f CLAUDE.md ] && echo "| Project | $(pwd -P)/CLAUDE.md | 36 |"
    [ -f .claude/rules/jerome.md ] && echo "| Project | $(pwd -P)/.claude/rules/jerome.md | \${FAKE_CLAUDE_MD_TOKENS:-496} |"
    [ -f .jerome/PROJECT.md ] && echo "| Project | $(pwd -P)/.jerome/PROJECT.md | 1.1k |"
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
  // launchctl records its calls; FAKE_LAUNCHCTL_PRINT=fail makes `launchctl print` report the job as not loaded.
  writeFileSync(join(bin, 'launchctl'), `#!/bin/sh\necho "$*" >> "$HOME/launchctl.log"\n[ "$1" = print ] && [ "$FAKE_LAUNCHCTL_PRINT" = fail ] && exit 113\nexit 0\n`);
  chmodSync(join(bin, 'launchctl'), 0o755);
  const config = join(root, 'claude-config');
  mkdirSync(join(config, 'skills', 'synced', 'acct', 'docx'), { recursive: true });
  writeFileSync(join(config, 'skills', 'synced', 'acct', 'docx', 'SKILL.md'), '');
  // runWith adds environment variables for one call, e.g. a broken /context on an existing project.
  const call = (extra, input, args, cwd = root) => spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: root,
      CLAUDE_CONFIG_DIR: config,
      FAKE_LOGGED_IN: loggedIn ? '1' : '0',
      GIT_CONFIG_NOSYSTEM: '1',
      JEROME_BIN: BIN,
      FAKE_NODE: process.execPath,
      JEROME_NOTIFY: 'off',
      // The tests read English, whatever the machine's language (D162).
      JEROME_LANGUAGE: 'en',
      ...env,
      ...extra,
    },
  });
  const runWith = (extra, ...args) => call(extra, '', args);
  const run = (...args) => call({}, '', args);
  // runInput passes text on standard input, e.g. a brief for `--from-file -`.
  const runInput = (input, ...args) => call({}, input, args);
  // runWithInput does both, e.g. a hook payload with CLAUDE_PROJECT_DIR set.
  const runWithInput = (extra, input, ...args) => call(extra, input, args);
  // runIn runs it from another folder, e.g. a project's, for commands that take the current one.
  const runIn = (cwd, ...args) => call({}, '', args, cwd);
  return { root, run, runWith, runInput, runWithInput, runIn };
}

// Where a sandbox project's database is (D93): the store under the sandbox's home, which the CLI runs with.
export function sandboxDb(root, dir) {
  return join(root, '.local', 'share', 'jerome', 'projects', storeKey(cloneRoot(dir)), 'jerome.db');
}

// A project ready for heartbeats: created, committed, and trusted in Claude Code.
export function readyProject(env = {}) {
  const box = sandbox({ env });
  assert.equal(box.run('new', 'demo').status, 0);
  const dir = realpathSync(join(box.root, 'demo'));
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'ignore' });
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const trust = (value) => writeFileSync(join(box.root, 'claude-config', '.claude.json'), JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: value } } }));
  trust(true);
  const db = () => new DatabaseSync(sandboxDb(box.root, dir), { readOnly: true });
  // For tests that put the database in a state of their own.
  const writableDb = () => new DatabaseSync(sandboxDb(box.root, dir));
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
  return { ...box, dir, git, trust, db, writableDb, lastRun, requests, calls, account };
}
