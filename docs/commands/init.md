# `jerome init [dir]`

Brings Jérôme into an existing project, in the folder `dir` (default: the current one). It never overwrites a file.

```sh
cd my-laravel-app
jerome init
```

## What it does

1. **Checks the setup**, as [`jerome new`](new.md) does. If something is missing, nothing is changed.
2. **Creates `.jerome/project.json`** and copies the template files the project does not have: `.claude/rules/jerome.md` and the `project-brief`, `project-team` and `docs` skills (see [project-layout.md](../project-layout.md)). A template file the project already has with different content, such as a skill of its own called `docs`, is left as it is and reported.
3. **Leaves the project's own files alone**: its `CLAUDE.md`, `.claude/CLAUDE.md` and `docs/` stay as they are. In `.claude/settings.json` it only adds Jérôme's permission rules, hooks and status line (a status line the project already has is kept), and to `.gitignore` only the lines it is missing.
4. **Runs [`jerome doctor`](doctor.md)**: lean profile, database, rules. If the project has its own `CLAUDE.md`, the report shows its tokens next to `jerome.md`'s, since both are loaded in every session and heartbeat.

It does not run `git init`: a folder that is not a repository is reported, since heartbeats need one.

## Then

Open `claude` in the project and ask for the briefing. For an adopted project, the lead agent first reads the project's own instructions and lists those that conflict with Jérôme's rules, for example on branches and merges, for you to settle; then it reads the project, its README and key files, rather than asking what they already say.

`--from-file <path|->` imports a brief instead, as with `jerome new`; it refuses if the files it would write already exist.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Jérôme is in place and the profile is lean |
| 1 | The folder does not exist, is already a Jérôme project, uses the layout from before `.jerome/` (run `jerome update`), the setup is incomplete, or the profile is not lean |
| 2 | Wrong usage |
