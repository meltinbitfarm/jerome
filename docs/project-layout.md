# Project layout

Jérôme keeps everything it needs in two places, so a project's root stays the project's own, whatever it is: a Laravel app, a Node package, a set of documents.

```
my-project/
├── .jerome/                    Jérôme's state
│   ├── project.json            Jérôme version, template files, budgets, limits, schedule
│   ├── PROJECT.md              goal, constraints, agent limits, project rules: loaded at every turn
│   ├── scope.md                context, out of scope, success, tools, pace, each area's context: read when needed
│   ├── areas.md                the areas: goal, milestone, criteria, folder, agents, pace, priority
│   ├── decisions.md            the decisions, one per line
│   ├── open.md                 open questions and parked topics
│   ├── archive.md              closed entries, with their IDs
│   ├── brief.md                the original brief
│   ├── digest.md               one line per heartbeat
│   ├── watch/                  copies of the pages areas follow, kept out of git
│   ├── docs-queue.md           documentation changes waiting for the documentarist
│   └── notes/                  the agents' detailed reports
├── .claude/
│   ├── rules/jerome.md         the lead agent's instructions (from the template)
│   ├── skills/                 project-brief, project-team, docs (from the template)
│   ├── agents/                 the project's team, created with your approval
│   ├── settings.json           permission rules, hooks, status line (versioned)
│   └── settings.local.json     the lean profile (machine-specific, kept out of git)
├── CLAUDE.md                   the project's own, if it has one: never touched by Jérôme
├── docs/                       the project's documentation, kept by the documentarist
└── .gitignore                  gets .claude/settings.local.json and .jerome/jerome.db*
```

## The lead agent's instructions

They are in `.claude/rules/jerome.md`, not in a `CLAUDE.md`: Claude Code loads a rules file without a `paths` field at startup, with the same priority as `.claude/CLAUDE.md`, so the project keeps both its `CLAUDE.md` and its `.claude/CLAUDE.md` for itself. `jerome.md` imports `.jerome/PROJECT.md` with `@../../.jerome/PROJECT.md`, a path relative to the file. Measured on real calls, the cost is the same as with a `CLAUDE.md` at the root (25 tokens more on a project, for the longer path), and Jérôme's agents, which set `omitClaudeMd`, leave rules files out as well.

When the project has its own `CLAUDE.md`, both are loaded in every session and every heartbeat. `jerome doctor` shows the tokens of each, and the briefing of an adopted project starts by reading the project's instructions and pointing out those that conflict with Jérôme's, for you to settle.

## What is versioned

The database is not in the project: it lives outside the working tree, where no checkout reaches it (see [database.md](database.md#where-it-lives)).

Everything in `.jerome/`, and everything in `.claude/` but `settings.local.json`. Moves of state files are ordinary commits, so their history stays with them.

Uncommitted changes cost tokens: Claude Code puts the repository's status in the context of every call, so a long list of changed files is paid again at each one (about 500 tokens with some thirty changes on a real project).

## Projects from before `.jerome/`

Projects created by earlier versions kept these files at their root. `jerome update` moves them once, with `git mv`, after asking, and moves the database out of the working tree with a backup and a check of every table (see [update.md](commands/update.md#moving-an-older-project-to-jerome)). Do it on the branch you keep working on.
