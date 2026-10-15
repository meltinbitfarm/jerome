# Where usage data comes from

Jérôme tracks token usage per project, per agent and per run, plus how much of the subscription's usage windows is used. These are the sources Claude Code exposes, and the ones Jérôme uses. The hooks run the reader after each turn, subagent and session (see [hooks.md](hooks.md)).

## Token usage: session transcripts

Claude Code writes every session as JSON Lines under `~/.claude/projects/<encoded-folder>/`:

- the lead agent's session: `<session_id>.jsonl`
- each subagent: `<session_id>/subagents/agent-<agent_id>.jsonl`, plus a `.meta.json` with the agent type

Each `assistant` line carries `message.model`, `requestId` and `message.usage`. The usage fields are input tokens, output tokens, cache reads and cache writes, with the cache writes split by TTL. A response with several content blocks is written as several lines with the same `requestId` and the same usage, so lines must be **deduplicated by `requestId`** before summing. The usage is not always the same on every line: `output_tokens` grows until the last line of the response. Jérôme keeps each field's largest value, which is the final one; on a real project 11 of 134 calls had lines with different usage.

Hook payloads do not carry token counts. They carry the transcript paths: `transcript_path`, and `agent_transcript_path` for `SubagentStop`. Jérôme uses hooks as the trigger to read the right transcript, so the model spends no tokens on tracking.

## Subscription usage: two sources

Neither hooks nor transcripts expose how much of the subscription is used. Two places do:

1. **Headless runs with `--output-format stream-json`** emit a `rate_limit_event`:
   ```json
   {"type": "rate_limit_event", "rate_limit_info": {
     "unifiedWindows": {
       "five_hour": {"utilization": 0.42, "resetsAt": 1791998400},
       "seven_day": {"utilization": 0.1,  "resetsAt": 1792548000}}}}
   ```
2. **The status line input**, in interactive sessions, after the first response:
   ```json
   "rate_limits": {
     "five_hour": {"used_percentage": 43, "resets_at": 1791998400},
     "seven_day": {"used_percentage": 10, "resets_at": 1792548000}}
   ```

This is account-wide data, not per project. Jérôme stores the latest reading in `~/.config/jerome/account.json`, writes it only when the value changes, and expresses its global limits as percentages of these two windows. See [database.md](database.md).

## Costs

`total_cost_usd` and `costUSD` in Claude Code's output are list-price equivalents, not what a subscription actually charges. Jérôme computes the same kind of figure from the API list prices in `src/models.js` and always labels it as an API equivalent, for example `≈$3.40 API`; `+?` means some calls used a model without a known price. On an Opus 5.5 call, Jérôme's price matches the $0.1139 Claude Code reported.
