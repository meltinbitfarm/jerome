# Configuration

Where each setting of a Jérôme project lives, and how to change it. Each section answers one practical question.

| What | Where | How to change it |
|---|---|---|
| Global limits on the subscription windows | `~/.config/jerome/account.json` | `jerome limits --five-hour 70 --seven-day 75` |
| The project's spending limits | `.jerome/project.json`, `limits` | `jerome limits --daily 5 --weekly 20` |
| How often heartbeats run, and their caps | `.jerome/project.json`, `heartbeat`, and the launchd job | `jerome schedule daily --at 09:00 --max-tokens 300000` |
| The quota governor: on or off, target, reserve, 5-hour cap, the projects it fills | `~/.config/jerome/account.json`, `governor`, on this machine only | [`jerome governor on --target 90`](commands/governor.md), `jerome governor add` |
| This Mac's link to Jérôme Director: its key, the Director's pinned key | `~/.config/jerome/director.json`, readable by you only | [`jerome connect`](commands/connect.md), `jerome disconnect` |
| Jérôme Director, on the server: its address, its keys | `$XDG_DATA_HOME/jerome-director/` (the `director-data` volume in Docker), and `.env` next to `compose.yaml` | [`jerome director init`](commands/director.md) |
| Telegram bridge: bot token and your chat | `~/.config/jerome/telegram.json`, readable by you only, never in a project | [`jerome telegram setup`](commands/telegram.md) |
| Slots, branches, max duration, test command, allowed tools, quota and alert channel of the runs | `.jerome/project.json`, `heartbeat` (`slots`, `mainBranch`, `workBranch`, `maxMinutes`, `test`, `allow`, `quota`, `alerts`) | edit it, or ask the lead agent, then `jerome heartbeat install` |
| Lift the limits on one project's runs for today | `~/.cache/jerome/heartbeat/` | `jerome heartbeat override --today` |
| An agent's model | `.claude/agents/<name>.md`, `model` | ask the lead agent |
| The lead agent's model in your sessions | Claude Code: `--model`, `/model`, or `model` in `.claude/settings.json` | `claude --model sonnet` |
| The lead agent's model in heartbeats | `.jerome/project.json`, `heartbeat.model` | `jerome schedule daily --model sonnet` (default `opus`) |
| An area's pace, priority, or pause | `.jerome/areas.md` | ask the lead agent, or hold an area briefing |
| Budgets of the files loaded at every turn | `.jerome/project.json`, `budgets` | edit the file |
| Agent limits | `.jerome/PROJECT.md`, `## Agent limits` | ask the lead agent |
| Permission rules that make the limits binding | `.claude/settings.json`, `permissions` | `jerome doctor` keeps them |

## Ask the lead agent, or run a command?

**Ask the lead agent** for anything that is a decision about the project: an agent's model or tools, an agent limit, an area's goal, milestone, pace or priority, a new area. It changes the file and records the change in `.jerome/decisions.md`, one line with its reason, so it is not questioned again later, and it keeps related files in step: an agent limit is copied into every agent it applies to, an area's agents are listed in `areas.md`. A change made by hand in those files is not recorded anywhere, and the lead agent may not notice it.

**Run a command** for settings about how much the project may spend and when it runs: limits and schedules. They take effect at once, are checked by the CLI, and are not decisions about the work. The one value with no command, the budgets, is edited in `.jerome/project.json`; `jerome doctor` reports an invalid budget, and the default applies.

Everything in `.jerome/` and `.claude/settings.json` is versioned: commit a change you make by hand. Heartbeats skip while the working tree has uncommitted changes, `.jerome/project.json` excepted. `account.json` and the launchd job are on your machine only.

## How much of the subscription may scheduled runs use?

The global limits are percentages of the subscription's 5-hour and 7-day windows. They hold for every project on the machine, since the subscription is one: [`jerome projects`](commands/projects.md) shows them once, above every project. They live in `~/.config/jerome/account.json`, next to the latest reading of each window.

```sh
jerome limits --five-hour 70 --seven-day 75
jerome limits --seven-day off
```

When a window reaches its limit, heartbeats pause at zero tokens until it resets; your sessions are never blocked, you are warned. Suggested: 70% for 5 hours, 75% for 7 days. See [limits.md](limits.md#global-limits).

## How much may this project spend?

The project's limits are in API-equivalent dollars, per calendar day and per calendar week, counting every use of the project. They live in `.jerome/project.json`, under `limits`; without it, $5 a day and $20 a week apply.

```sh
jerome limits --daily 3 --weekly 15
jerome limits --weekly default
jerome limits --daily off
```

```json
"limits": { "daily": 3, "weekly": 15 }
```

`jerome limits` with no option shows every limit with the current usage. Limits are per project, not per area. See [limits.md](limits.md#project-limits).

## How often do heartbeats run, and how much can one use?

The schedule and the caps per run live in `.jerome/project.json`, under `heartbeat`; the launchd job that starts them lives in `~/Library/LaunchAgents/`.

```sh
jerome schedule daily --at 09:00
jerome schedule hourly --at :15 --max-tokens 300000 --max-turns 20
jerome schedule --off
```

```json
"heartbeat": { "every": "daily", "hour": 9, "minute": 0, "maxTokens": 500000, "maxTurns": 40 }
```

Scheduling again replaces the schedule and the caps (defaults: 500,000 tokens and 40 turns). For several runs a day, or different work at different times, a project has slots instead, with the other settings of its runs (branches, max duration, test command, quota, alert channel) beside them: see [heartbeat.md](heartbeat.md#slots), then `jerome heartbeat install`. For one heartbeat run by hand, `jerome heartbeat --max-tokens 50000 --max-turns 10` sets caps for that run only. Each heartbeat works on one area: how often each area gets one is its own pace, below. See [`jerome schedule`](commands/schedule.md).

## Which model does an agent use?

Each agent declares its model in its file, `.claude/agents/<name>.md`:

```markdown
---
name: researcher
tools: Read, Grep, Glob, WebSearch, WebFetch, Write
model: sonnet
omitClaudeMd: true
---
```

Ask the lead agent, for example "put the researcher on Haiku": it edits the file and records the decision. It never changes a model on its own, and proposes one when it sees a reason. `jerome doctor` warns about an agent without a declared model. See [agents.md](agents.md#changing-an-agent).

## Which model does the lead agent use?

**In your sessions**, the one you start Claude Code with, as in any project: `claude --model opus`, `/model` during the session, or a project default in `.claude/settings.json`:

```json
"model": "opus"
```

**In heartbeats**, Opus by default. Set it with the schedule; a new `jerome schedule` without `--model` keeps it, and `--model default` goes back to Opus:

```sh
jerome schedule daily --at 09:00 --model sonnet
```

```json
"heartbeat": { "every": "daily", "hour": 9, "minute": 0, "maxTokens": 500000, "maxTurns": 40, "model": "sonnet" }
```

The triage that comes before the lead agent always runs on Haiku.

## How do I pace an area, rank it, or pause it?

Each area's `Pace` (`hourly`, `daily`, `weekly`, `paused`) and `Priority` (1 is the highest) are lines of its section in `.jerome/areas.md`:

```markdown
## marketing
- Pace: weekly
- Priority: 2
```

Ask the lead agent, for example "pause the marketing area until January" or "put support before marketing": it changes the lines and records the decision. To add an area or change its goal, milestone or criteria, ask for an area briefing. A paused area gets no heartbeats until you change it back; an area waiting for a decision request of its own gets none until you answer. See [areas.md](areas.md).

## How much may the files loaded at every turn weigh?

`jerome.md` (850 tokens) and `PROJECT.md` (800 tokens) are loaded into every session and every heartbeat, so `jerome doctor` warns when one goes over its budget, as measured by Claude Code's `/context`. It never blocks anything. To raise a budget, add it to `.jerome/project.json`:

```json
"budgets": { "PROJECT.md": 1200 }
```

Before raising it, consider moving what is not needed at every turn from `PROJECT.md` to `scope.md`, which is read only when needed. See [lead-agent.md](lead-agent.md#token-budget).

## What may agents do, and what stops them?

**Agent limits** are lines of `.jerome/PROJECT.md`, under `## Agent limits`, such as the default:

```markdown
- L1: No sending, publishing, deploying, pushing, purchases or emails: drafts and proposals only (default).
```

Ask the lead agent to change them: it records the decision and copies the limits that apply into the `## Project limits` section of each agent, since agents do not read `PROJECT.md`.

**Permission rules** in `.claude/settings.json` make the default limits binding: Claude Code denies pushing, publishing, deploying and sending email to the lead agent and to every agent, and allows the safe local git operations and the tests. `jerome doctor` adds any rule that is missing and keeps your own; `jerome doctor --check` fails while one is missing. You can add rules of your own next to them. To run a denied command yourself, type it with `!` in the session (`! git push`) or in a terminal: the rules apply to the model, not to you. See [agents.md](agents.md#binding-limits).
