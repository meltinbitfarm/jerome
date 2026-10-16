// What Jérôme depends on in Claude Code (D77): every command, flag, field, file and behaviour that a Claude Code
// release could break, with the decisions and the code that use it. `jerome deps --json` prints it for tools that
// watch Claude Code releases, such as claude-watch. Keeping it current is part of finishing every phase, and a test
// checks that every field the code reads is listed here.
import { VERSION } from './template.js';

export const DEPS_SCHEMA = 'jerome.deps/v1';
export const VERIFIED_ON = ['2.1.299', '2.1.300'];

// presence: "always" when Claude Code always sends it (missing = broken), "sometimes" when it may be absent
// (only its type is checked when present). documented: false when Claude Code's documentation does not describe it.
const d = (area, path, use, { event = null, kind = 'field', presence = 'always', documented = true, decisions = [], phase, code = [], note = null } = {}) =>
  ({ area, event, path, kind, presence, documented, decisions, phase, code, use, note });

export const DEPS = [
  // Command line.
  d('cli', 'claude --version', 'setup check', { kind: 'command', decisions: ['V3'], phase: 1, code: ['src/checks.js'] }),
  d('cli', 'claude auth status', 'setup check: subscription login', { kind: 'command', decisions: ['V3', 'D21'], phase: 1, code: ['src/checks.js'], note: 'JSON on stdout, also when it exits with 1 (logged out)' }),
  d('cli', 'auth status: loggedIn', 'logged in', { decisions: ['V3'], phase: 1, code: ['src/checks.js'] }),
  d('cli', 'auth status: authMethod', '"claude.ai" for a subscription', { decisions: ['V3'], phase: 1, code: ['src/checks.js'] }),
  d('cli', 'auth status: email', 'shown in the setup check', { presence: 'sometimes', decisions: ['V3'], phase: 1, code: ['src/checks.js'] }),
  d('cli', 'claude plugin list --json', 'plugins to turn off in the lean profile', { kind: 'command', decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('cli', '--json', 'plugin list as JSON', { kind: 'flag', decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('cli', 'plugin list: id', 'plugin id for enabledPlugins', { decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('cli', 'claude -p /context', 'lean profile check and token budgets; a local command, no tokens', { kind: 'command', decisions: ['D21', 'D37'], phase: 1, code: ['src/profile.js'] }),
  d('cli', '--no-session-persistence', 'checks and service calls leave no transcript', { kind: 'flag', decisions: ['D43', 'D63'], phase: 4, code: ['src/profile.js', 'src/docs.js', 'src/heartbeat.js'] }),
  d('cli', '--settings', 'the project\'s lean profile for runs started outside it', { kind: 'flag', decisions: ['D43'], phase: 4, code: ['src/docs.js', 'src/heartbeat.js'] }),
  d('cli', '--add-dir', 'file access without loading that folder\'s CLAUDE.md', { kind: 'flag', decisions: ['D43'], phase: 4, code: ['src/docs.js'] }),
  d('cli', '--agents', 'an agent defined inline', { kind: 'flag', decisions: ['D43'], phase: 4, code: ['src/docs.js'] }),
  d('cli', '--agent', 'that agent as the main session', { kind: 'flag', decisions: ['D43'], phase: 4, code: ['src/docs.js'] }),
  d('cli', '--model', 'model of a service call or heartbeat', { kind: 'flag', decisions: ['D43', 'D73'], phase: 4, code: ['src/docs.js', 'src/heartbeat.js'] }),
  d('cli', '--tools', 'built-in tools allowed; "" for none', { kind: 'flag', decisions: ['D43', 'D73'], phase: 4, code: ['src/docs.js', 'src/heartbeat.js'] }),
  d('cli', '--allowedTools', 'write access limited with absolute rules such as Edit(//abs/docs/**)', { kind: 'flag', decisions: ['D43'], phase: 4, code: ['src/docs.js'] }),
  d('cli', '--output-format', '"json" and "stream-json"', { kind: 'flag', decisions: ['D43', 'D73'], phase: 4, code: ['src/docs.js', 'src/heartbeat.js'] }),
  d('cli', '--verbose', 'required by stream-json', { kind: 'flag', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('cli', '--session-id', 'the heartbeat gives its run\'s id to the session', { kind: 'flag', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('cli', '--max-turns', 'heartbeat turn cap; ends with subtype error_max_turns', { kind: 'flag', documented: false, decisions: ['D71', 'D73'], phase: 8, code: ['src/heartbeat.js'], note: 'absent from --help' }),
  d('cli', '--permission-mode', '"acceptEdits" for heartbeats', { kind: 'flag', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),

  // Result of -p --output-format json.
  d('result', 'result', 'final text of the documentarist', { decisions: ['D43', 'D73'], phase: 4, code: ['src/docs.js', 'src/heartbeat.js'] }),
  d('result', 'is_error', 'failed run', { decisions: ['D43'], phase: 4, code: ['src/docs.js'] }),
  d('result', 'duration_ms', 'start time of a service run', { presence: 'sometimes', decisions: ['D63'], phase: 6, code: ['src/docs.js'] }),
  d('result', 'modelUsage.*.inputTokens', 'usage of service calls, which leave no transcript', { decisions: ['D63', 'D73'], phase: 6, code: ['src/docs.js'] }),
  d('result', 'modelUsage.*.outputTokens', 'usage of service calls', { decisions: ['D63'], phase: 6, code: ['src/docs.js'] }),
  d('result', 'modelUsage.*.cacheReadInputTokens', 'usage of service calls', { decisions: ['D63'], phase: 6, code: ['src/docs.js'] }),
  d('result', 'modelUsage.*.cacheCreationInputTokens', 'usage of service calls, counted as 1-hour cache writes', { decisions: ['D63'], phase: 6, code: ['src/docs.js'] }),

  // Stream of -p --output-format stream-json --verbose.
  d('stream', 'type', '"assistant", "rate_limit_event", "result"', { decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'result.modelUsage', 'the triage\'s verdict (result) and usage, read from the last event of its stream, which carries the fields of the json result', { event: 'result', decisions: ['D73', 'D100'], phase: 10, code: ['src/heartbeat.js'] }),
  d('stream', 'message.id', 'deduplicating the live usage; repeats with growing usage', { event: 'assistant', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'message.usage.input_tokens', 'heartbeat token cap', { event: 'assistant', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'message.usage.output_tokens', 'heartbeat token cap', { event: 'assistant', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'message.usage.cache_read_input_tokens', 'heartbeat token cap', { event: 'assistant', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'message.usage.cache_creation_input_tokens', 'heartbeat token cap', { event: 'assistant', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'rate_limit_info.unifiedWindows.five_hour.utilization', 'subscription window, 0 to 1, from the lead agent\'s and the triage\'s streams', { event: 'rate_limit_event', presence: 'sometimes', documented: false, decisions: ['D20', 'D52'], phase: 8, code: ['src/heartbeat.js'], note: 'the event may not come in every run' }),
  d('stream', 'rate_limit_info.unifiedWindows.five_hour.resetsAt', 'window reset, Unix seconds', { event: 'rate_limit_event', presence: 'sometimes', documented: false, decisions: ['D20', 'D52'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'rate_limit_info.unifiedWindows.seven_day.utilization', 'subscription window, 0 to 1', { event: 'rate_limit_event', presence: 'sometimes', documented: false, decisions: ['D20', 'D52'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'rate_limit_info.unifiedWindows.seven_day.resetsAt', 'window reset, Unix seconds', { event: 'rate_limit_event', presence: 'sometimes', documented: false, decisions: ['D20', 'D52'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'message.content[].type, name, input, text', 'the action shown on the progress line', { event: 'assistant', presence: 'sometimes', documented: false, decisions: ['D79'], phase: 8, code: ['src/progress.js'] }),
  d('stream', 'subtype', '"success", "error_max_turns", …', { event: 'result', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'is_error', 'how the run ended', { event: 'result', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),
  d('stream', 'result', 'error text', { event: 'result', decisions: ['D73'], phase: 8, code: ['src/heartbeat.js'] }),

  // Transcripts.
  d('transcript', '<config>/projects/<folder>/<session_id>.jsonl', 'a session\'s transcript; <config> is ~/.claude or $CLAUDE_CONFIG_DIR', { kind: 'file', documented: false, decisions: ['D20', 'D67'], phase: 6, code: ['src/delegations.js', 'src/hooks.js'] }),
  d('transcript', '<session_id>/subagents/agent-<agent_id>.jsonl', 'a subagent\'s transcript, next to the session\'s', { kind: 'file', documented: false, decisions: ['D20', 'D59'], phase: 6, code: ['src/hooks.js', 'src/delegations.js'] }),
  d('transcript', 'type', '"assistant" and "user" lines', { documented: false, decisions: ['D20'], phase: 5, code: ['src/usage.js', 'src/delegations.js'] }),
  d('transcript', 'requestId', 'one row per API call; repeats across the lines of one response', { event: 'assistant', documented: false, decisions: ['D20', 'D53'], phase: 5, code: ['src/usage.js'] }),
  d('transcript', 'timestamp', 'time of the call', { documented: false, decisions: ['D53'], phase: 5, code: ['src/usage.js', 'src/delegations.js'] }),
  d('transcript', 'message.model', 'price lookup; may carry a suffix such as [1m]', { event: 'assistant', documented: false, decisions: ['D20', 'D57'], phase: 5, code: ['src/usage.js'] }),
  d('transcript', 'message.usage.input_tokens', 'usage', { event: 'assistant', documented: false, decisions: ['D20', 'D53'], phase: 5, code: ['src/usage.js'] }),
  d('transcript', 'message.usage.output_tokens', 'usage; grows until the last line of a response, the largest value is kept', { event: 'assistant', documented: false, decisions: ['D20', 'D53'], phase: 5, code: ['src/usage.js'] }),
  d('transcript', 'message.usage.cache_read_input_tokens', 'usage', { event: 'assistant', documented: false, decisions: ['D20', 'D53'], phase: 5, code: ['src/usage.js'] }),
  d('transcript', 'message.usage.cache_creation_input_tokens', 'usage', { event: 'assistant', documented: false, decisions: ['D20', 'D53'], phase: 5, code: ['src/usage.js'] }),
  d('transcript', 'message.usage.cache_creation.ephemeral_5m_input_tokens', 'cache writes by duration', { event: 'assistant', presence: 'sometimes', documented: false, decisions: ['D53'], phase: 5, code: ['src/usage.js'] }),
  d('transcript', 'message.usage.cache_creation.ephemeral_1h_input_tokens', 'cache writes by duration', { event: 'assistant', presence: 'sometimes', documented: false, decisions: ['D53'], phase: 5, code: ['src/usage.js'] }),
  d('transcript', 'message.content[].type', '"text" and "tool_use" blocks', { documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js', 'src/hooks.js'] }),
  d('transcript', 'message.content[].text', 'a subagent\'s final text', { presence: 'sometimes', documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),
  d('transcript', 'message.content[].id', 'links an Agent call to its subagent', { presence: 'sometimes', documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),
  d('transcript', 'message.content[].name', '"Agent" (or "Task") and "SubagentHandback" tool calls', { presence: 'sometimes', documented: false, decisions: ['D62', 'D67'], phase: 7, code: ['src/delegations.js', 'src/hooks.js'] }),
  d('transcript', 'tool_use input: Bash command and description, Read/Edit/Write file_path, Skill skill, Grep/Glob pattern', 'what each lead agent call touched, in the viewer', { presence: 'sometimes', documented: false, decisions: ['D78'], phase: 7, code: ['src/delegations.js'] }),
  d('transcript', 'Agent input.subagent_type', 'delegations', { presence: 'sometimes', documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),
  d('transcript', 'Agent input.description', 'delegations', { presence: 'sometimes', documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),
  d('transcript', 'Agent input.prompt', 'the task given to a subagent', { presence: 'sometimes', documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),
  d('transcript', 'SubagentHandback input.message', 'the reply of a subagent in the background', { presence: 'sometimes', documented: false, decisions: ['D62', 'D67'], phase: 6, code: ['src/hooks.js', 'src/delegations.js'] }),
  d('transcript', 'message.content (first user line)', 'a subagent\'s task when no Agent call matches', { event: 'user', presence: 'sometimes', documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),
  d('transcript', '<config>/projects/<path with every other character as ->/', 'a project\'s transcripts, for the latest session', { kind: 'file', documented: false, decisions: ['D81'], phase: 8, code: ['src/session-shape.js'] }),
  d('transcript', 'api-request-shape: shape.tools[].name', 'the tools really sent, checked against the deny rules', { event: 'api-request-shape', documented: false, decisions: ['D81'], phase: 8, code: ['src/session-shape.js'], note: 'recorded once per session, at its first request' }),
  d('transcript', 'attachment: attachment.type agent_listing_delta, rendered', 'the agents listed to the model, checked against the deny rules', { event: 'attachment', presence: 'sometimes', documented: false, decisions: ['D81'], phase: 8, code: ['src/session-shape.js'] }),
  ...['Agent', 'Bash', 'Edit', 'Read', 'Write', 'Skill', 'ToolSearch', 'DeferredToolPlaceholder', 'advisor'].map((tool) =>
    d('tool', tool, 'expected in every request; another tool over 2,000 characters is reported', { kind: 'expected-tool', presence: 'sometimes', documented: false, decisions: ['D81'], phase: 8, code: ['src/session-shape.js'] })),
  d('context', '| System tools (deferred) |', 'not added to the estimate: it does not follow the deny rules', { kind: 'section', presence: 'sometimes', documented: false, decisions: ['D81'], phase: 8, code: ['src/profile.js'] }),
  d('subagent-meta', 'agentType', 'the subagent\'s name, in agent-<id>.meta.json', { documented: false, decisions: ['D59', 'D67'], phase: 6, code: ['src/hooks.js', 'src/delegations.js'] }),
  d('subagent-meta', 'description', 'delegations', { presence: 'sometimes', documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),
  d('subagent-meta', 'toolUseId', 'links the subagent to its Agent call', { documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),
  d('subagent-meta', 'requestShape', '"background" or "foreground"', { presence: 'sometimes', documented: false, decisions: ['D67'], phase: 7, code: ['src/delegations.js'] }),

  // Hook configuration, input and output.
  d('hook-config', 'hooks.<Event>[].matcher', 'PreToolUse on Bash only', { kind: 'setting', decisions: ['D59'], phase: 6, code: ['src/hookconfig.js'] }),
  d('hook-config', 'hooks.<Event>[].hooks[].type, command', 'Jérôme\'s hook commands', { kind: 'setting', decisions: ['D59'], phase: 6, code: ['src/hookconfig.js'] }),
  d('hook-config', 'hooks.<Event>[].hooks[].async', 'Stop and SubagentStop in the background; claude -p cancels them at exit', { kind: 'setting', decisions: ['D59'], phase: 6, code: ['src/hookconfig.js'] }),
  d('hook-config', 'hooks.<Event>[].hooks[].timeout', 'SessionEnd gets 10 s instead of its 1.5 s budget', { kind: 'setting', decisions: ['D59'], phase: 6, code: ['src/hookconfig.js'] }),
  d('hook-input', 'session_id', 'the session\'s run', { event: '*', decisions: ['D59'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'transcript_path', 'the session\'s transcript', { event: '*', decisions: ['D20', 'D59'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'cwd', 'the project, when CLAUDE_PROJECT_DIR is missing', { event: '*', decisions: ['D59'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'CLAUDE_PROJECT_DIR', 'the project, from the hook\'s environment', { event: '*', kind: 'env', decisions: ['D59'], phase: 6, code: ['src/hooks.js', 'src/statusline.js'] }),
  d('hook-input', 'source', 'run reopened on resume; no context after compact', { event: 'SessionStart', decisions: ['D59', 'D74'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'agent_id', 'which subagent stopped', { event: 'SubagentStop', decisions: ['D20', 'D59'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'agent_type', 'usage per agent, reply lengths', { event: 'SubagentStop', decisions: ['D20', 'D59', 'D62'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'agent_transcript_path', 'the subagent\'s transcript', { event: 'SubagentStop', decisions: ['D20', 'D59'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'last_assistant_message', 'reply length; empty for a subagent in the background', { event: 'SubagentStop', decisions: ['D62'], phase: 6, code: ['src/hooks.js'], note: 'only presence and type are checked, never the text' }),
  d('hook-input', 'reason', 'why the session ended, on the run', { event: 'SessionEnd', decisions: ['D59'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'tool_name', '"Bash" for the chain check', { event: 'PreToolUse', decisions: ['D61'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-input', 'tool_input.command', 'the chained-command check, the second protection of D49', { event: 'PreToolUse', decisions: ['D49', 'D61'], phase: 6, code: ['src/hooks.js'], note: 'for tool_name "Bash"' }),
  d('hook-input', 'agent_type', 'which agent a refused chain came from', { event: 'PreToolUse', presence: 'sometimes', decisions: ['D61'], phase: 6, code: ['src/hooks.js'], note: 'present for a subagent\'s tool call' }),
  d('hook-output', 'hookSpecificOutput.permissionDecision', '"deny" refuses the call', { event: 'PreToolUse', decisions: ['D61'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-output', 'hookSpecificOutput.permissionDecisionReason', 'shown to the model', { event: 'PreToolUse', decisions: ['D61'], phase: 6, code: ['src/hooks.js'] }),
  d('hook-output', 'systemMessage', 'a warning shown to the user, not the model, when limits are near or reached', { event: 'SessionStart', decisions: ['D84'], phase: 9, code: ['src/hooks.js'] }),
  d('hook-output', 'hookSpecificOutput.additionalContext', 'open decision requests shown to the model at session start', { event: 'SessionStart', decisions: ['D74'], phase: 8, code: ['src/hooks.js'] }),

  // Status line.
  d('statusline-config', 'statusLine.type, command', 'Jérôme\'s status line, and the user\'s own one', { kind: 'setting', decisions: ['D60'], phase: 6, code: ['src/hookconfig.js', 'src/statusline.js'] }),
  d('statusline-input', 'rate_limits.five_hour.used_percentage', 'subscription window', { presence: 'sometimes', decisions: ['D23', 'D60'], phase: 6, code: ['src/statusline.js'], note: 'absent before the session\'s first response' }),
  d('statusline-input', 'rate_limits.five_hour.resets_at', 'window reset', { presence: 'sometimes', decisions: ['D23', 'D60'], phase: 6, code: ['src/statusline.js'] }),
  d('statusline-input', 'rate_limits.seven_day.used_percentage', 'subscription window', { presence: 'sometimes', decisions: ['D23', 'D60'], phase: 6, code: ['src/statusline.js'] }),
  d('statusline-input', 'rate_limits.seven_day.resets_at', 'window reset', { presence: 'sometimes', decisions: ['D23', 'D60'], phase: 6, code: ['src/statusline.js'] }),
  d('statusline-input', 'workspace.project_dir', 'the project', { presence: 'sometimes', decisions: ['D60'], phase: 6, code: ['src/statusline.js'] }),
  d('statusline-config', 'ANSI colours in the command\'s output', 'limits coloured by how close they are', { kind: 'behaviour', decisions: ['D84'], phase: 9, code: ['src/statusline.js'] }),
  d('statusline-input', 'cwd', 'the project, as a fallback', { decisions: ['D60'], phase: 6, code: ['src/statusline.js'] }),

  // /context, read strictly by parseContext.
  d('context', '## Context Usage', 'the report\'s heading', { kind: 'section', documented: false, decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('context', '**Tokens:**', 'estimated startup context', { kind: 'section', documented: false, decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('context', '### Estimated usage by category | Category | Tokens | Percentage', 'MCP leaks: categories starting with "MCP tools"', { kind: 'section', documented: false, decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('context', '### Skills | Skill | Source | Tokens', 'skill leaks; sources Project, User, Local, Flag, Managed, Built-in, MCP, Memory store, claude.ai sync, Plugin (<name>)', { kind: 'section', documented: false, decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('context', '### Memory Files | Type | Path | Tokens', 'token budgets of CLAUDE.md and PROJECT.md; absolute paths; left out when empty', { kind: 'section', presence: 'sometimes', documented: false, decisions: ['D37'], phase: 2, code: ['src/profile.js', 'src/doctor.js'] }),

  // Settings and files Jérôme writes or reads.
  d('settings', 'disableClaudeAiConnectors', 'lean profile', { kind: 'setting', decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('settings', 'disableBundledSkills', 'lean profile', { kind: 'setting', decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('settings', 'enabledPlugins.<id>', 'lean profile: false turns a plugin off', { kind: 'setting', decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('settings', 'skillOverrides.<name>', 'lean profile: "off"; synced skills as anthropic-skills:<name>', { kind: 'setting', decisions: ['D14', 'D21'], phase: 1, code: ['src/profile.js'] }),
  d('settings', 'permissions.deny with a whole tool name removes its definition from the request', 'tools Jérôme never uses, out of every call', { kind: 'behaviour', documented: false, decisions: ['D80'], phase: 8, code: ['src/limits.js'] }),
  ...['Artifact', 'SendFeedback', 'ScheduleWakeup', 'ReportFindings', 'ListAgents', 'AskUserQuestion'].map((tool) =>
    d('tool', tool, 'denied: a renamed tool would come back into every call unnoticed', { kind: 'tool-name', documented: false, decisions: ['D80'], phase: 8, code: ['src/limits.js'] })),
  ...['claude', 'claude-code-guide', 'Plan', 'statusline-setup'].map((agent) =>
    d('tool', `Agent(${agent})`, 'built-in agent denied, out of the agent listing', { kind: 'agent-name', documented: false, decisions: ['D80'], phase: 8, code: ['src/limits.js'] })),
  d('settings', 'permissions.deny, ask, allow', 'Bash(<prefix> *) rules; deny, then ask, then allow; deny holds for subagents, headless and bypass', { kind: 'setting', decisions: ['D46', 'D48'], phase: 4, code: ['src/limits.js'] }),
  d('files', '<config>/skills/synced/<account>/<skill>/SKILL.md', 'skills synced from claude.ai', { kind: 'file', documented: false, decisions: ['D21'], phase: 1, code: ['src/profile.js'] }),
  d('files', '~/.claude.json projects.<path>.hasTrustDialogAccepted', 'trust; allow rules are ignored without it', { kind: 'file', documented: false, decisions: ['D48', 'D73'], phase: 4, code: ['src/limits.js'] }),
  d('files', '<config>/settings.json statusLine.command', 'the user\'s own status line', { kind: 'file', decisions: ['D60'], phase: 6, code: ['src/statusline.js'] }),
  d('files', '.claude/agents/*.md front matter: name, description, tools, model, omitClaudeMd', 'the team; omitClaudeMd keeps CLAUDE.md out of subagents', { kind: 'file', decisions: ['D27', 'D41'], phase: 4, code: ['src/agents.js'] }),
  d('files', '.claude/skills/*/SKILL.md front matter: name, description, disable-model-invocation', 'project-brief, project-team, docs', { kind: 'file', decisions: ['D14', 'D43'], phase: 3, code: ['template/'] }),
  d('files', '.claude/rules/jerome.md, loaded at launch like .claude/CLAUDE.md (a rules file without paths front matter)', 'the lead agent\'s instructions, out of the way of the project\'s own CLAUDE.md', { kind: 'file', decisions: ['D87'], phase: 9, code: ['template/.claude/rules/jerome.md', 'src/doctor.js'] }),
  d('files', '@../../.jerome/PROJECT.md import, relative to the importing file; a missing import is skipped', 'PROJECT.md in every session', { kind: 'file', decisions: ['D7', 'D36', 'D87'], phase: 9, code: ['template/.claude/rules/jerome.md'] }),
  d('behaviour', 'omitClaudeMd keeps .claude/rules files out of subagents too', 'subagents without the lead agent\'s instructions (2,209 tokens with them in rules, 2,189 in .claude/CLAUDE.md)', { kind: 'behaviour', documented: false, decisions: ['D27', 'D87'], phase: 9 }),
  d('behaviour', 'a project\'s own CLAUDE.md, .claude/CLAUDE.md and rules are loaded next to jerome.md', 'their weight is shown by doctor', { kind: 'behaviour', decisions: ['D88'], phase: 9, code: ['src/doctor.js'] }),

  // Behaviours measured in the phases.
  d('behaviour', 'auto mode drops broad allow rules', 'test commands allowed as exact commands', { kind: 'behaviour', decisions: ['D48'], phase: 4, code: ['src/limits.js'] }),
  d('behaviour', 'writes to .claude/ need approval, allow rules do not grant them', 'creating agents asks the user', { kind: 'behaviour', decisions: ['D42'], phase: 4 }),
  d('behaviour', 'new agents are listed from the next session', 'the team after creation', { kind: 'behaviour', decisions: ['D42'], phase: 4 }),
  d('behaviour', 'environment variables reach the Bash tool', 'JEROME_SESSION_ID links a request to its heartbeat', { kind: 'behaviour', decisions: ['D74'], phase: 8, code: ['src/heartbeat.js', 'src/request.js'] }),
  d('behaviour', 'a hook exiting with a code other than 0 or 2 blocks nothing', 'hooks never fail a session', { kind: 'behaviour', decisions: ['D59'], phase: 6 }),
  d('behaviour', 'a folder per working directory in <config>/projects/', 'one fixed service folder per project', { kind: 'behaviour', documented: false, decisions: ['D43'], phase: 4, code: ['src/docs.js'] }),

  // Model ids priced in src/models.js; others are counted and shown with "+?".
  d('model', 'claude-opus-5-5', 'price', { kind: 'model', decisions: ['D57'], phase: 5, code: ['src/models.js'] }),
  d('model', 'claude-sonnet-5-5', 'price', { kind: 'model', decisions: ['D57'], phase: 5, code: ['src/models.js'] }),
  d('model', 'claude-haiku-5-5', 'price, two tiers by prompt size', { kind: 'model', decisions: ['D57'], phase: 5, code: ['src/models.js'] }),
  d('model', 'claude-fable-5-1', 'price', { kind: 'model', decisions: ['D57'], phase: 5, code: ['src/models.js'] }),
];

export function depsReport() {
  return { schema: DEPS_SCHEMA, jerome: VERSION, verifiedOn: VERIFIED_ON, items: DEPS };
}

export async function deps({ json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(depsReport(), null, 2));
    return 0;
  }
  console.log(`What Jérôme ${VERSION} depends on in Claude Code (verified on ${VERIFIED_ON.join(', ')}). * = undocumented.`);
  let area = null;
  for (const item of DEPS) {
    if (item.area !== area) {
      area = item.area;
      console.log(`\n${area}`);
    }
    const where = item.event ? `[${item.event}] ` : '';
    console.log(`  ${where}${item.path}${item.documented ? '' : ' *'}${item.presence === 'sometimes' ? ' (may be absent)' : ''} — ${item.use} · ${item.decisions.join(', ')}`);
  }
  return 0;
}
