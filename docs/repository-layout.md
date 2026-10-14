# Repository layout

Jérôme is developed with Jérôme, so this repository holds two different things.

```
.
├── bin/, src/           the jerome CLI (Node.js, no dependencies)
├── test/                tests, run with `npm test`
├── template/            what ends up in every project
│   ├── MANIFEST         the paths copied into projects and kept in sync
│   └── .claude/skills/  the project-brief skill (canonical copy)
├── docs/                this documentation
├── PROJECT.md           ┐
├── decisions.md         │ Jérôme's own project state and development notes,
├── open.md              │ written in Italian; never copied into projects
├── PLAN.md              │
├── notes/               ┘
└── .jerome              marks this folder as a Jérôme project
```

## The template

- `jerome new` copies only the paths listed in `template/MANIFEST`. Future updates to existing projects will touch only those paths, so a project's own state is never overwritten: `PROJECT.md`, `decisions.md`, `open.md`, `brief.md` and the database.
- Two files are not in the template because the CLI creates them in each project:
  - `.jerome`;
  - `.claude/settings.json`, whose lean profile depends on the machine (see [lean-profile.md](lean-profile.md)).
- The root `.claude/skills/project-brief` is a symlink to the template copy. Developing Jérôme and using Jérôme share one version of the skill.

## The package

The npm package contains only `bin/`, `src/` and `template/`, as listed in `files` in `package.json`.
