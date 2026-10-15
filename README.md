# Jérôme

A lean setup for running projects with [Claude Code](https://docs.claude.com/en/docs/claude-code) on a Claude subscription. Each project gets one **lead agent** that runs the briefing, creates the subagents the work needs, coordinates them and reports back. Token usage is the first constraint: sessions start with the smallest possible context, and the tracking runs outside the model.

The name is a nod to Saint Jerome, patron saint of translators: the lead agent translates ideas into tasks.

> **Status: early development.** What works today: creating a project, from scratch or from a brief (`jerome new`), the lead agent's instructions, the briefing (`jerome prompt` and the `project-brief` skill), keeping the lean profile in place (`jerome doctor`) and updating a project's template files (`jerome update`). Usage tracking, the viewer and scheduled runs are planned; see [Roadmap](#roadmap).

## Requirements

- macOS or Linux
- Node.js 24 or later
- git
- Claude Code, logged in with a Claude subscription (`claude auth login`), not an API key

### Node version managers and scheduled runs

If Node.js comes from a version manager such as nvm, `node` and `jerome` live in a folder like `~/.nvm/versions/node/<version>/bin/`, which only your interactive shell knows about. Jobs started by launchd or cron do not load your shell profile, so they would not find `node`, `jerome` or `claude`.

Scheduled runs (planned) will deal with this: when a run is scheduled, Jérôme records the absolute paths of `node`, `jerome` and `claude` found at that moment, and `jerome doctor` will warn you if one of them no longer exists. If you switch Node version with nvm, or reinstall jerome under a different version, run `jerome doctor` and reschedule the runs it reports.

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

`jerome new` checks your setup before creating anything. If something is missing, such as the Claude Code login, it stops and tells you what to fix.

If you already have a brief, for example from a briefing on your phone, start from it:

```sh
pbpaste | jerome new my-project --from-file -
```

## Commands

| Command | What it does |
|---|---|
| [`jerome new <name> [--from-file <path\|->]`](docs/commands/new.md) | Creates a project from the template, with git and the lean profile, optionally from a brief |
| [`jerome prompt`](docs/commands/prompt.md) | Prints the briefing instructions, to paste into any chat |
| [`jerome doctor [dir] [--check] [--json]`](docs/commands/doctor.md) | Checks the setup and restores the lean profile of a project; `--check` only reports, `--json` gives a machine-readable report |
| [`jerome update [dir] [--check] [--yes]`](docs/commands/update.md) | Brings a project's template files up to the installed version, without touching its state |
| [`jerome state [dir] [--json]`](docs/commands/state.md) | Shows a project's usage, runs and open decision requests in a few lines, with dollars as API equivalents |
| [`jerome docs [dir]`](docs/commands/docs.md) | Brings the documentation queue into the project's docs, with the documentarist on Haiku |

## The lean profile

Out of the box, every Claude Code session loads the descriptions of all your installed plugins, synced skills and claude.ai connectors. On the test machine that was about 29k tokens before the first word. Jérôme projects turn all of that off in their own `.claude/settings.local.json`, which git ignores, and keep only the project's skills, which brings startup down to about 12k tokens. Your user settings are not touched.

Details: [docs/lean-profile.md](docs/lean-profile.md). Where usage data comes from: [docs/usage-data.md](docs/usage-data.md); how it is recorded: [docs/hooks.md](docs/hooks.md); where it is kept: [docs/database.md](docs/database.md).

## The lead agent

The template's `CLAUDE.md` turns the main Claude Code session into the project's lead agent. It speaks your language, keeps the project state, delegates to the project's agents, and only drafts things it is not allowed to do, such as deploying. It is kept within 680 tokens, because it is loaded into every session, and `PROJECT.md` holds only what is needed at every turn, with the rest of the brief in `scope.md`, read when needed. See [docs/lead-agent.md](docs/lead-agent.md).

## Agents and limits

After the brief, the lead agent proposes a team from Jérôme's catalog (developer, writer, researcher, analyst, clerk, documentarist), each with a model chosen for its kind of work, and creates it only after you confirm. Agents skip `CLAUDE.md`, reply in a few lines and queue documentation changes for the documentarist. Each task runs on a branch, which the lead agent merges into `main` itself when the tests pass. Pushing, publishing, deploying and sending email are denied by permission rules in the project's `.claude/settings.json`, for the lead agent and every subagent; the safe local git operations and the tests are allowed. See [docs/agents.md](docs/agents.md).

## The briefing

Every project starts from a brief in the `brief/v2` format. You can run the briefing anywhere: in Claude Code inside the project, with the template's `project-brief` skill, which writes the project files directly; or in any chat (claude.ai, ChatGPT, Gemini…) with the instructions printed by `jerome prompt`, then import the result with `jerome new --from-file`. A text that is not a valid brief is accepted too: the lead agent converts it in the first session, with your confirmation. See [docs/project-brief.md](docs/project-brief.md).

## Roadmap

1. ~~Project creation and setup checks~~ (`jerome new`, `jerome doctor`)
2. ~~Lead agent instructions in the project's `CLAUDE.md`~~
3. ~~Briefing anywhere and import of a brief (`jerome prompt`, `jerome new --from-file`), template updates (`jerome update`)~~
4. Rules for creating subagents, including a documentation agent (`jerome docs`)
5. ~~A SQLite database per project, read with `jerome state`~~
6. ~~Usage tracking through hooks and the status line~~
7. Read-only local viewer (`jerome view`)
8. Scheduled headless runs, with a lock and a budget per run
9. Daily and weekly limits with automatic pause

## Repository layout

The root of this repository holds Jérôme's own development files. Only `template/` ends up in projects. See [docs/repository-layout.md](docs/repository-layout.md).

## License

[MIT](LICENSE)
