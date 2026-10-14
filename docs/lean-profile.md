# The lean profile

Every Claude Code session starts with a fixed amount of context: the system prompt, the built-in tools, and the descriptions of everything installed at user level. In a project with a lead agent and many short subagent and scheduled runs, that fixed cost is paid again and again. Jérôme keeps it as low as Claude Code allows.

## What it turns off

All of this goes in the project's own `.claude/settings.local.json`, which `jerome new` adds to `.gitignore`. User-level settings are never modified, and neither is the versioned `.claude/settings.json`.

| Setting | Effect |
|---|---|
| `enabledPlugins: { "<plugin>@<marketplace>": false }` | Turns off every installed plugin, including plugins synced from claude.ai (`@synced`) |
| `disableClaudeAiConnectors: true` | Turns off the claude.ai connectors (remote MCP servers), together with their tool lists and server instructions |
| `disableBundledSkills: true` | Turns off the skills bundled with Claude Code |
| `skillOverrides: { "<skill>": "off" }` | Turns off skills synced from claude.ai, and any other skill that is not part of the project |

Skills synced from claude.ai are turned off by their qualified name (`anthropic-skills:<name>`). The plain name would also turn off a project skill with the same name. Each project ships its own copy of the `project-brief` skill, which stays on, while the synced copy is turned off.

A project that needs an MCP server declares it in its own `.mcp.json`.

## Measured effect

These numbers come from `claude -p "Reply only: ok"` with Opus, on a machine with four plugins, fifteen synced skills and several claude.ai connectors. Each row adds one setting to the previous ones.

| Configuration | Input tokens of the first request |
|---|---:|
| Nothing turned off | 28,726 |
| + plugins off | 24,873 |
| + claude.ai connectors off | 17,559 |
| + bundled skills off | 15,379 |
| + synced skills off (lean profile) | 12,378 |

What is left, about 12k tokens, is the system prompt and the built-in tool definitions, which cannot be removed while logged in with a subscription. `claude --bare` would remove more, but it only accepts an API key.

Your numbers depend on what you have installed. Run `claude -p "/context"` inside a project to see what is loaded.

## Why it is generated, not copied

The list of plugins and synced skills depends on the machine and changes over time. That is why `jerome new` generates the profile and `jerome doctor` keeps it current. A static file in the template could not do this.

For the same reason the profile lives in the local settings file and stays out of git. A teammate, or your other computer, has different plugins and generates its own profile with `jerome doctor`. Claude Code applies `settings.local.json` on top of `settings.json`, so the profile wins over any shared setting.

Projects created by earlier versions of Jérôme had the profile in `settings.json`. `jerome doctor` moves those entries to the local file, and deletes `settings.json` if nothing else is left in it.
