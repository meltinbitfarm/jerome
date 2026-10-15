# Repository layout

Jérôme is developed with Jérôme, so this repository holds two different things.

```
.
├── bin/, src/           the jerome CLI (Node.js, no dependencies)
├── test/                tests, run with `npm test`
├── template/            what ends up in every project
│   ├── MANIFEST         the paths copied into projects and kept in sync
│   ├── CLAUDE.md        the lead agent's instructions
│   └── .claude/skills/  the project-brief skill (canonical copy)
├── docs/                this documentation
├── PROJECT.md           ┐
├── decisions.md         │ Jérôme's own project state and development notes;
├── open.md              │ never copied into projects
├── PLAN.md              │
├── notes/               ┘
├── brief.md             the original brief, kept in Italian as a snapshot
└── .jerome              marks this folder as a Jérôme project
```

## The template

- `jerome new` copies only the paths listed in `template/MANIFEST`, and [`jerome update`](commands/update.md) touches only those paths, so a project's own state is never overwritten: `PROJECT.md`, `decisions.md`, `open.md`, `archive.md`, `brief.md`, `.jerome`, the local settings and the database. A MANIFEST that listed one of them would be refused.
- Project-specific rules for the lead agent go in `PROJECT.md` under `## Project rules`, never in template files, so updates never conflict with them (see [lead-agent.md](lead-agent.md#project-rules)).
- Two files are not in the template because the CLI creates them in each project:
  - `.jerome`, a JSON file that records the Jérôme version and the template files the project was last reconciled with (see [update.md](commands/update.md#the-jerome-file));
  - `.claude/settings.local.json`, with the lean profile, which depends on the machine and is kept out of git (see [lean-profile.md](lean-profile.md)).
- The root `.claude/skills/project-brief` is a symlink to the template copy. Developing Jérôme and using Jérôme share one version of the skill.

## The package

The npm package contains only `bin/`, `src/` and `template/`, as listed in `files` in `package.json`.
