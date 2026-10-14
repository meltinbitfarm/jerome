# Phase 0.5 — Usage data: what is there and where

Test run on 2026-10-14, Claude Code 2.1.299, logged in with a Max 5x subscription. It was a headless session (`claude -p`, lead agent on Opus 5.5) delegating a trivial task to a subagent called `contatore` (counter) on Haiku 5.5. Hooks on SessionStart, SubagentStop, Stop and SessionEnd saved the raw JSON. The test ran outside git and its configuration was removed afterwards.

## 1. Hook payloads: no tokens

No event carries tokens, cost or model. They carry identifiers and paths:

| Event | Useful fields |
|---|---|
| SessionStart | `session_id`, `transcript_path`, `cwd`, `source` (`startup`) |
| SubagentStop | `agent_id`, `agent_type` (`contatore`), `agent_transcript_path`, `last_assistant_message`, `prompt_id`, `effort.level` |
| Stop | `session_id`, `transcript_path`, `prompt_id`, `last_assistant_message` |
| SessionEnd | `session_id`, `transcript_path`, `reason` |

SubagentStop example:
```json
{"session_id":"47d40c0f-…","agent_id":"a63e90cf2af7917be","agent_type":"contatore",
 "agent_transcript_path":"~/.claude/projects/<cwd>/47d40c0f-…/subagents/agent-a63e90cf2af7917be.jsonl",
 "last_assistant_message":"9","hook_event_name":"SubagentStop"}
```
So hooks work as a **signal and an index**: they say when to read and which file.

## 2. JSONL transcripts: per-call detail

- Lead agent: `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`
- Subagent: `…/<session_id>/subagents/agent-<agent_id>.jsonl`, plus a `.meta.json` with `agentType`, `toolUseId` and `spawnDepth`.

Each `type: "assistant"` line contains `message.model`, `requestId` and `message.usage`:
```json
{"input_tokens":2,"cache_creation_input_tokens":13871,"cache_read_input_tokens":8608,
 "output_tokens":163,"output_tokens_details":{"thinking_tokens":0},
 "cache_creation":{"ephemeral_1h_input_tokens":13871,"ephemeral_5m_input_tokens":0}}
```
- **Lead agent and subagent are kept apart**: separate files, and the subagent's lines carry `isSidechain: true` and `agentId`.
- In the lead agent's transcript, the Agent tool's `toolUseResult` summarizes the subagent: `agentId`, `agentType`, `resolvedModel: "claude-haiku-5-5"`, `usage`, `totalTokens: 1012` and `totalDurationMs`.
- **Double counting risk**: a response with several blocks (thinking and text) writes several lines with the same `requestId` and the same `usage`. To avoid it, deduplicate by `requestId`.
- The file's last line is `type: "cost-state"`: session totals per model (tokens and `costUSD`). It includes the subagent too, so it must not be added to the details.
- Cache detail: the lead agent writes the cache with a 1h TTL, the subagent with 5m.

## 3. `claude -p` output

**`--output-format json`** returns a single final object, with:
- `total_cost_usd` (0.1976), aggregate `usage` and `num_turns`;
- `modelUsage` split by model (opus: 239 out, 31087 cache read, 23309 cache write; haiku: 3 out, 1007 cache write), with `costUSD` and `costBasis: "list"`;
- `subagent_stats`: spawned, completed, failed and `by_type: {"contatore": 1}`.

With a subscription, `costUSD` is the **list-price equivalent**, not actual spending.

**`--output-format stream-json --verbose`** gives the same data plus messages and `hook_*` events, and above all a **`rate_limit_event`**:
```json
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour",
 "resetsAt":1791998400,"overageStatus":"rejected","isUsingOverage":false,
 "unifiedWindows":{"five_hour":{"utilization":0.42,"resetsAt":1791998400},
                   "seven_day":{"utilization":0.1,"resetsAt":1792548000}}}}
```

## 4. Subscription usage

- **It is exposed in `stream-json`** (`rate_limit_event`) **and in the status line input** (see §5): usage of the 5-hour and 7-day windows (a 0–1 fraction, e.g. 0.42 = 42%), reset time and overage status. It is **account data, not project data**.
- It does not appear in hook payloads, in transcripts, or in the `result` of `--output-format json`.
- `~/.claude.json` → `oauthAccount` contains only the plan (`organizationType: claude_max`, `organizationRateLimitTier: default_claude_max_5x`), not the usage.
- Not verified: whether the event arrives on every run or only when something changes. In this test it arrived once, after the first response.

## 5. Status line: yes, it contains the subscription limits

An **interactive** session (in tmux) was given a status line that saves its input to a file. Before the first response the field is missing; afterwards `rate_limits` arrives, with the same values as `stream-json` as whole percentages:
```json
"rate_limits":{"five_hour":{"used_percentage":43,"resets_at":1791998400},
               "seven_day":{"used_percentage":10,"resets_at":1792548000}}
```
The same input also has `cost.total_cost_usd`, `context_window.current_usage` (tokens of the last call) and `transcript_path`.
Consequence: interactive sessions can update the % in the global DB too. A template status line that calls `jerome` and prints one line is enough. This supersedes point 3 below, but does not change D20.

## 6. Fixed startup cost of a headless session

Measurement: `claude -p "<one-word reply>" --output-format json`, with the lead agent on Opus 5.5. The value is the sum of input, cache write and cache read of the first and only call. Each row adds its exclusion to the previous ones, through the project's `.claude/settings.json`:

| Configuration | Input tokens | Difference | Skills loaded |
|---|---:|---:|---:|
| A. as is (everything installed at user level) | 28,726 | — | 59 |
| B. + `enabledPlugins`: the 4 plugins set to `false` | 24,873 | −3.9k | 28 |
| C. + `disableClaudeAiConnectors: true` | 17,559 | −7.3k | 28 |
| D. + `disableBundledSkills: true` | 15,379 | −2.2k | 16 |
| E. + `skillOverrides`: skills synced from claude.ai set to `"off"`, except project-brief | 12,378 | −3.0k | 2 |

List price of the first call (cache still to be written): A $0.163, E $0.032.

**What it is made of:**
- **≈12.4k fixed and not removable:** system prompt (2.4k) and the schemas of Claude Code's core tools.
- **claude.ai connectors (≈7.3k):** the heaviest item. The tool schemas do not weigh, since they stay deferred (`/context` estimates 173k, never loaded); what weighs is the list of tool names and above all the MCP servers' instructions (a handful of connectors for notes, knowledge base, analytics and CRM). The weight varies between runs because connectors load asynchronously: in the first test the call was 22.5k.
- **Skill descriptions (≈9k in total):** plugins 3.9k (one e-commerce plugin alone has 22 skills), skills synced from claude.ai 3.0k, bundled skills 2.2k.

**Can they be excluded per project?** Yes, all of the ones seen, with the project's `.claude/settings.json` and without touching the user configuration:
- `enabledPlugins: {"<plugin>@<marketplace>": false}`, including synced plugins (`@synced`);
- `disableClaudeAiConnectors: true` (same as `ENABLE_CLAUDEAI_MCP_SERVERS=false`);
- `disableBundledSkills: true`;
- `skillOverrides: {"<skill>": "off"}`, which also works on skills synced from claude.ai.

`--bare` would remove almost everything, but it only accepts `ANTHROPIC_API_KEY`, not the subscription login, so it cannot be used.

**Watch out:** phase 3 uses MementoVault, which today arrives as a claude.ai connector. With connectors off, the project has to configure Memento as its own MCP server, or keep connectors on only where needed, for example not in heartbeats. The list of plugins to turn off depends on what the user has installed: the template cannot know it in advance, so `jerome new` has to generate it.

## Decision (approved, recorded as D20)

**Source of usage data:**
1. **Tokens per agent and per run are read from the JSONL transcripts, with hooks as the trigger.** `jerome hook subagent-stop` reads `agent_transcript_path`, while `stop` and `session-end` read `transcript_path`. In every case the `assistant` lines are summed after deduplicating by `requestId`, and model, input, output, cache read and cache write (1h and 5m) are stored. Cost is estimated from the seed's model table, not from the transcript's `costUSD`. Only numbers are stored, not content.
2. **Heartbeats run with `--output-format stream-json`.** The CLI reads `result`, as a cross-check of the totals, and `rate_limit_event`, which stores the 5h and 7-day subscription % in the **global** DB, with a timestamp. This gives phase 9 a real % instead of a hand-calibrated estimate, and shrinks Q2 considerably.
3. For interactive sessions the subscription % is not available: the viewer shows the latest value read by a heartbeat, with its date.

**Consequences for the phase 5 schema:**
- a usage table per request or per agent, with session_id, agent_id, agent_type, model and the four token counters;
- a global table with the subscription readings (window, usage, reset, read at).

**Risk:** the transcript format is not a documented, stable interface. The parser must be kept small, isolated and tolerant of missing fields.
