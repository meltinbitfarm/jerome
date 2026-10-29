# Jérôme

A lean setup for running projects with [Claude Code](https://docs.claude.com/en/docs/claude-code) on a Claude subscription. A project is a product or an initiative, not only code: each one gets a **lead agent** that runs the briefing, creates the subagents the work needs, coordinates them across the project's areas (development, marketing, research…) and reports back. Token usage is the first constraint: sessions start with the smallest possible context, and the tracking runs outside the model.

The name is a nod to Saint Jerome, patron saint of translators: the lead agent translates ideas into tasks.

> **Status: early development.** All the phases of the [roadmap](#roadmap) are in place: projects (`jerome new`, `jerome init`), the lead agent and its team, usage tracking, the viewer, heartbeats and limits. They have been tried on real projects, but not yet on a clean machine.

## How it works

```mermaid
flowchart TD
  you([You]) -->|brief, answers| lead
  lead -->|decision requests| you
  subgraph project [Project]
    lead[Lead agent<br/>the main Claude Code session]
    state[(.jerome/<br/>PROJECT.md · areas.md<br/>decisions.md · open.md)]
    lead <--> state
    subgraph dev [Area: development · milestone MVP]
      developer[developer · Opus]
      analyst[analyst · Sonnet]
    end
    subgraph mkt [Area: marketing · milestone pre-launch]
      writer[writer · Opus]
      researcher[researcher · Sonnet]
    end
  end
  lead --> developer
  lead --> analyst
  lead --> writer
  lead --> researcher
```

You start from a brief. The lead agent keeps the project's state, proposes a team of agents for each **area**, and works with you in your sessions and on its own in scheduled **heartbeats**, one task at a time, towards each area's current **milestone**. When something is yours to decide, it leaves a **decision request** and waits; when a milestone is reached, it proposes the next. [docs/guide.md](docs/guide.md) follows a project from the idea to its second area, step by step, and [docs/configuration.md](docs/configuration.md) lists every setting: where it lives and how to change it.

## Requirements

- macOS or Linux
- Node.js 24 or later
- git
- Claude Code, logged in with a Claude subscription (`claude auth login`), not an API key

### Node version managers and scheduled runs

If Node.js comes from a version manager such as nvm, `node` and `jerome` live in a folder like `~/.nvm/versions/node/<version>/bin/`, which only your interactive shell knows about. Jobs started by launchd or cron do not load your shell profile, so they would not find `node`, `jerome` or `claude`.

Heartbeats deal with this: when you run `jerome schedule`, Jérôme records the absolute paths of `node`, `jerome` and `claude` found at that moment, and `jerome doctor` warns you if one of them no longer exists. If you switch Node version with nvm, or reinstall jerome under a different version, run `jerome doctor` and reschedule with the command it gives.

## Install

```sh
npm install -g github:meltinbitfarm/jerome
```

## Quick start

```sh
jerome new my-project
cd my-project
claude
```

For an existing project, run `jerome init` in its folder instead: it adds Jérôme's files without overwriting any of yours.

`jerome new` checks your setup before creating anything. If something is missing, such as the Claude Code login, it stops and tells you what to fix.

If you already have a brief, for example from a briefing on your phone, start from it:

```sh
pbpaste | jerome new my-project --from-file -
```

## Commands

| Command | What it does |
|---|---|
| [`jerome new <name> [--from-file <path\|->]`](docs/commands/new.md) | Creates a project from the template, with git and the lean profile, optionally from a brief |
| [`jerome init [dir]`](docs/commands/init.md) | Brings Jérôme into an existing project, overwriting nothing |
| [`jerome prompt`](docs/commands/prompt.md) | Prints the briefing instructions, to paste into any chat |
| [`jerome doctor [dir] [--check] [--json]`](docs/commands/doctor.md) | Checks the setup and restores the lean profile of a project; `--check` only reports, `--json` gives a machine-readable report; relinks the database of a project that moved |
| [`jerome forget <key>`](docs/commands/forget.md) | Removes the database of a project that is gone, after a backup |
| [`jerome language [code]`](docs/commands/language.md) | The language Jérôme writes to you in: notifications, Telegram, decision requests (`en`, `it`) |
| [`jerome update [dir] [--check] [--yes]`](docs/commands/update.md) | Brings a project's template files up to the installed version, without touching its state |
| [`jerome state [dir] [--json]`](docs/commands/state.md) | Shows a project's usage, areas, runs and open decision requests in a few lines, with dollars as API equivalents |
| [`jerome view [dir]`](docs/commands/view.md) | Opens a read-only page in the browser: at the top the project's [board](docs/board.md) (now, to do, done, in plain words in your language, with a legend of the IDs), then the team, areas, runs, usage, subscription windows and the messages between agents |
| [`jerome projects [--json] [--view]`](docs/commands/projects.md) | Shows every project on this machine, from any folder, with what needs you first; `--view` as a page in the browser |
| [`jerome schedule [dir] hourly\|daily\|weekly`](docs/commands/schedule.md) | Schedules heartbeats, runs of the lead agent without you, with a cap per run (macOS) |
| [`jerome heartbeat [dir]`](docs/commands/heartbeat.md) | One scheduled run, as launchd starts it; `install`, `uninstall`, `status`, `run <slot>`, `marathon --until HH:MM` and `override --today` for a project's slots and their runs |
| [`jerome request`](docs/commands/request.md) | Opens and closes decision requests |
| [`jerome telegram setup`](docs/commands/telegram.md) | Connects a Telegram bot: what waits for you from every project, answers to requests, notes, `/status`, and buttons that clear a block from afar (allow a tool, trust a folder, try again, skip); no model, zero tokens |
| [`jerome watchdog install`](docs/commands/watchdog.md) | The machine's job, every minute: closes lost runs, reports heartbeats that did not start, has the boards' new texts put in plain words, runs the Telegram bridge, the quota governor and the beat to the Director |
| [`jerome connect`](docs/commands/connect.md), [`jerome director`](docs/commands/director.md) | [Jérôme Director](docs/director.md): one coordinator for all your Macs, on your server with Docker, reached over any VPN, with signed requests and answers, and a dashboard for the phone with each project's board |
| [`jerome governor on`](docs/commands/governor.md), [`jerome quota`](docs/commands/quota.md) | The quota governor: reads the subscription's real quota and starts fill runs while the week is behind its pace, to reach the weekly reset at about 90% |
| [`jerome note`](docs/commands/note.md) | Lists and closes the notes you sent a project from Telegram |
| [`jerome digest [dir]`](docs/commands/digest.md) | What happened recently, at zero tokens |
| [`jerome limits [dir]`](docs/commands/limits.md) | Shows and sets the usage limits that pause heartbeats: global in % of the subscription windows, per project in API-equivalent dollars |
| [`jerome deps [--json]`](docs/commands/deps.md) | Lists what Jérôme depends on in Claude Code, for tools that watch Claude Code releases |
| [`jerome docs [dir]`](docs/commands/docs.md) | Brings the documentation queue into the project's docs, with the documentarist on Haiku |
| [`jerome hook <event>`](docs/commands/hook.md), [`jerome statusline`](docs/commands/statusline.md) | Run by Claude Code, not by you: they record usage and show the status line |

## The lean profile

Out of the box, every Claude Code session loads the descriptions of all your installed plugins, synced skills and claude.ai connectors. On the test machine that was about 29k tokens before the first word. Jérôme projects turn all of that off in their own `.claude/settings.local.json`, which git ignores, and keep only the project's skills, which brings startup down to about 12k tokens. Your user settings are not touched.

Details: [docs/lean-profile.md](docs/lean-profile.md). Where usage data comes from: [docs/usage-data.md](docs/usage-data.md); how it is recorded: [docs/hooks.md](docs/hooks.md); where it is kept: [docs/database.md](docs/database.md).

## Project layout

Jérôme keeps its state in `.jerome/` and the lead agent's instructions in `.claude/rules/jerome.md`, so the project's root, its own `CLAUDE.md` and its `docs/` stay the project's:

```
my-project/
├── .jerome/
│   ├── project.json     Jérôme's record: version, template files, limits, schedule
│   ├── PROJECT.md       loaded at every turn: goal, constraints, agent limits
│   ├── areas.md         the areas: goal, milestone and criteria, folder, agents, pace, priority
│   ├── scope.md, decisions.md, open.md, archive.md, brief.md, digest.md
│   ├── docs-queue.md    documentation changes waiting for the documentarist
│   └── notes/           the agents' detailed reports
└── .claude/
    ├── rules/jerome.md  the lead agent's instructions
    ├── skills/, agents/ the template's skills and the project's team
    └── settings.json    permission rules, hooks, status line
```

The project database is not in the folder: it lives in `~/.local/share/jerome/projects/`, where no checkout or `git clean` reaches it, one per clone. See [docs/project-layout.md](docs/project-layout.md) and [docs/database.md](docs/database.md#where-it-lives).

## The lead agent

The template's `.claude/rules/jerome.md` turns the main Claude Code session into the project's lead agent. It speaks your language, keeps the project state, delegates to the project's agents, and only drafts things it is not allowed to do, such as deploying. It is kept within 850 tokens, because it is loaded into every session, and `PROJECT.md` holds only what is needed at every turn, with the rest of the brief in `scope.md`, read when needed. See [docs/lead-agent.md](docs/lead-agent.md).

## Agents and limits

After the brief, the lead agent proposes a team from Jérôme's catalog (developer, writer, researcher, analyst, clerk, documentarist), each with a model chosen for its kind of work, and creates it only after you confirm. Agents skip the lead agent's instructions, reply in a few lines and queue documentation changes for the documentarist. Each task runs on a branch, which the lead agent merges into `main` itself when the tests pass. Pushing, publishing, deploying and sending email are denied by permission rules in the project's `.claude/settings.json`, for the lead agent and every subagent; the safe local git operations and the tests are allowed. See [docs/agents.md](docs/agents.md).

## Heartbeats

Nothing runs on its own until you schedule it. `jerome schedule daily` starts the lead agent every day through launchd, after cheap checks and a triage on Haiku that decide whether there is work and in which area, by each area's priority and pace, within a token and turn cap. When it needs you it leaves a decision request instead of asking. Heartbeats pause when a global or project limit is reached, and start again when it resets. A project can have several slots a day (`jerome heartbeat install`); no run is ever skipped silently, half-done work is resumed before anything new, every run is checked when it ends, and anything wrong is an alert you hear about first: in the status line, at the start of a session, and on [Telegram](docs/telegram.md) if you connect it, where you can also answer requests and leave the project notes. A watchdog job reports heartbeats that did not start and closes runs whose process died. With the [quota governor](docs/quota-governor.md) on, it also reads the subscription's real quota and starts fill runs while the week is behind its pace, so the weekly quota is used rather than lost. See [docs/heartbeat.md](docs/heartbeat.md) and [docs/limits.md](docs/limits.md); to replace scripts of your own, [docs/migrating-heartbeat-scripts.md](docs/migrating-heartbeat-scripts.md).

## The briefing

Every project starts from a brief in the `brief/v3` format, with the areas to start from; more are added later with an area briefing (see [docs/areas.md](docs/areas.md)). You can run the briefing anywhere: in Claude Code inside the project, with the template's `project-brief` skill, which writes the project files directly; or in any chat (claude.ai, ChatGPT, Gemini…) with the instructions printed by `jerome prompt`, then import the result with `jerome new --from-file`. A text that is not a valid brief is accepted too: the lead agent converts it in the first session, with your confirmation. See [docs/project-brief.md](docs/project-brief.md).

## Roadmap

1. ✓ Project creation and setup checks (`jerome new`, `jerome init`, `jerome doctor`)
2. ✓ Lead agent instructions, now in `.claude/rules/jerome.md`
3. ✓ Briefing anywhere and import of a brief (`jerome prompt`, `jerome new --from-file`), template updates (`jerome update`)
4. ✓ Rules for creating subagents, including a documentation agent (`jerome docs`)
5. ✓ A SQLite database per project, outside the working tree, read with `jerome state` and `jerome digest`
6. ✓ Usage tracking through hooks and the status line (`jerome hook`, `jerome statusline`)
7. ✓ Read-only local viewer (`jerome view`), and every project at a glance (`jerome projects`)
8. ✓ Scheduled headless runs, with a lock and a cap per run (`jerome schedule`, `jerome heartbeat`, `jerome request`); since 0.2.0 with slots, RESUME runs, an end check, a max duration, alerts and marathons
9. ✓ Daily and weekly limits with automatic pause (`jerome limits`)
10. ✓ Telegram bridge and watchdog (`jerome telegram`, `jerome watchdog`), since 0.3.0; blocks cleared with a button since 0.9.0
11. ✓ Quota governor on one Mac (`jerome governor`, `jerome quota`), since 0.4.0. Jérôme Director, the coordinator of several Macs ([docs/director.md](docs/director.md)), is in progress: the Macs connect and report since 0.5.0, the dashboard since 0.5.1, each project's board since 0.11.0; the permits and Telegram on the Director come next
12. Areas and milestones, with the area briefing (`.jerome/areas.md`): in place and tested, not yet tried on a real project

Along the way: `jerome deps` lists what Jérôme depends on in Claude Code, and `jerome forget` removes the database of a project that is gone.

## Repository layout

The root of this repository holds Jérôme's own development files. Only `template/` ends up in projects. See [docs/repository-layout.md](docs/repository-layout.md).

## License

[MIT](LICENSE)
