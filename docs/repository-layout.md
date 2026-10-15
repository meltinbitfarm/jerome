# Repository layout

Jérôme is developed with Jérôme, so this repository holds two different things.

```
.
├── bin/, src/           the jerome CLI (Node.js, no dependencies)
├── test/                tests, run with `npm test`
├── migrations/          the project database's schema, applied by the CLI
├── viewer/              the page served by `jerome view`
├── template/            what ends up in every project
│   ├── MANIFEST         the paths copied into projects and kept in sync (not copied itself)
│   ├── .claude/rules/jerome.md  the lead agent's instructions
│   └── .claude/skills/  project-brief, project-team (with the agent catalog) and docs
├── docs/                this documentation
├── PLAN.md              the development plan
└── .jerome/             Jérôme's own project state, like any project's (never copied into projects):
    ├── project.json     marks this folder as a Jérôme project
    ├── PROJECT.md, scope.md, decisions.md, open.md, archive.md
    ├── brief.md         the original brief, kept in Italian as a snapshot
    └── notes/           development notes, such as the usage probe
```

## The template

- `jerome new` copies only the paths listed in `template/MANIFEST`, and [`jerome update`](commands/update.md) touches only those paths, so a project's own state is never overwritten: everything in `.jerome/` and the local settings. A MANIFEST that listed them would be refused.
- Project-specific rules for the lead agent go in `PROJECT.md` under `## Project rules`, never in template files, so updates never conflict with them (see [lead-agent.md](lead-agent.md#project-rules)).
- The project's own paths are never in the MANIFEST either, even when they start from Jérôme: the agents in `.claude/agents/`, created from the catalog with your approval, `.claude/settings.json`, `docs/`, and the project's own `CLAUDE.md` and `.claude/CLAUDE.md` (see [agents.md](agents.md) and [project-layout.md](project-layout.md)).
- Three files are not in the template because the CLI creates them in each project:
  - `.jerome/project.json`, a JSON file that records the Jérôme version and the template files the project was last reconciled with (see [update.md](commands/update.md#the-jeromeprojectjson-file));
  - `.claude/settings.local.json`, with the lean profile, which depends on the machine and is kept out of git (see [lean-profile.md](lean-profile.md));
  - `.claude/settings.json`, versioned, with the permission rules that make the default limits binding (see [agents.md](agents.md#binding-limits)).
- The root `.claude/skills/` holds symlinks to the template's skills. Developing Jérôme and using Jérôme share one version of each.

## The package

The npm package contains only `bin/`, `src/`, `template/`, `migrations/` and `viewer/`, as listed in `files` in `package.json`.
