# `jerome update [dir]`

Brings the template files of an existing project up to the installed Jérôme version. `jerome new` copies the template only once, so this is how fixes to the lead agent's instructions or to the briefing skill reach projects created earlier.

```sh
npm install -g github:meltinbitfarm/jerome   # update Jérôme first
jerome update                                # in the project folder
```

## What it touches

Only the paths listed in the template's `MANIFEST`: today `.claude/rules/jerome.md` and the `project-brief`, `project-team` and `docs` skills. The `MANIFEST` itself stays in the installed package; projects created before this rule received a copy at their root, which `jerome update` removes if it is unchanged. Project state is never touched, and a `MANIFEST` that listed it would be refused: `PROJECT.md`, `scope.md`, `decisions.md`, `open.md`, `archive.md`, `brief.md`, `.jerome` and `.claude/settings.local.json`. The same holds for the paths that belong to the project even when they started from Jérôme: the agents in `.claude/agents/`, created from the catalog (see [agents.md](../agents.md)), `.claude/settings.json` with its deny rules, which [`jerome doctor`](doctor.md) maintains, `docs/` and `notes/`.

Rules that belong to one project go in `PROJECT.md` under `## Project rules`, never in `CLAUDE.md` or other template files (see [lead-agent.md](../lead-agent.md#project-rules)). That way updates never conflict with them.

## How it decides

Each template file in the project falls into one of these cases:

| Status | Meaning | What happens |
|---|---|---|
| `update` | Unchanged since it was copied, and the template has changed | Replaced, after one confirmation for all such files |
| `new` | Added to the template since the project was created | Copied, with the same confirmation |
| `changed here` | Changed in the project, and the template has changed too | Replaced only if you confirm that file on its own |
| `remove` | No longer in the template, and unchanged since it was copied | Deleted, with the same confirmation as `update` |
| up to date | Same as the template, or changed here and already kept against this template version | Nothing |

Before asking, it prints the list and a diff of each file, from the project's version (`project/…`) to the template's (`template/…`).

If you keep a file you changed, the choice is remembered: it is not offered again until the template changes that file once more.

Files the template no longer has, but that were changed in the project or have no record in `.jerome/project.json`, are reported and left in place, never deleted. Delete them yourself if you don't need them.

In Jérôme's own repository, recognized by its `package.json` and `template/MANIFEST`, the command refuses to run: the template there is the source, not a copy.

## Options

- `--check` shows the list and the diffs and writes nothing. It exits with 1 when something is behind, so scripts can use it.
- `--yes` applies the `update`, `new` and `remove` files without asking. Files changed in the project are left as they are and reported: run `jerome update` in a terminal to choose for them.

Without `--yes` and outside a terminal, nothing is written.

`jerome doctor` warns when template files are behind the installed version, without failing.

## Moving an older project to `.jerome/`

Projects created before Jérôme kept its files in `.jerome/` have them at their root. The first `jerome update` moves them (see [project-layout.md](../project-layout.md)), after showing what it will do and asking:

```
This project keeps Jérôme's files at its root. Jérôme 0.1.0 keeps them in .jerome/ and the lead agent's instructions in .claude/rules/jerome.md:
  move        .jerome → .jerome/project.json
  move        PROJECT.md → .jerome/PROJECT.md
  …
  move        docs/_pending.md → .jerome/docs-queue.md
  move        .jerome.db → /Users/you/.local/share/jerome/projects/my-project-3f2a9c1b7d04/jerome.db (outside the working tree)
  remove      CLAUDE.md (the template's, replaced by .claude/rules/jerome.md)
  paths       .claude/agents/developer.md (docs/_pending.md → .jerome/docs-queue.md, notes/ → .jerome/notes/)
  .gitignore  .jerome.db* → .jerome/jerome.db*
```

- Tracked files move with `git mv`, so their history follows them: review the moves and commit them.
- The root `CLAUDE.md` is removed only if it is still the template's, as its recorded hash shows. If it was changed in the project, it stays as the project's own, and `update` says to check that it does not repeat or contradict `jerome.md`.
- In the agents of `.claude/agents/`, which are the project's files, only the two moved paths are rewritten.
- The database never goes through git, which ignores it, and goes out of the working tree (see [database.md](../database.md#where-it-lives)). Before anything else moves, it is copied to a backup (`~/.cache/jerome/backups/`), checkpointed, and copied to its new place; only if every table has the same number of rows in the copy does the move go on, and the original is deleted only once the copy is in place. Otherwise nothing moves. If a session or a heartbeat is running in the project, nothing moves either: run it again once they are done.
- **Move on the branch you keep working on, and commit there**, then merge or delete the branches from before the move, where `.jerome` is still a file.
- `--check` shows the moves without making them.

Until a project is moved, `jerome doctor` fails with the command to run, its hooks record nothing, and heartbeats do not start.

## Moving the database out of `.jerome/`

Projects moved to `.jerome/` before the database left the working tree have it in `.jerome/jerome.db`, where a checkout of a branch from before the move, or `git clean -X`, can delete it. A real project lost its database this way: moved on a side branch, then `git switch main`. `jerome update` moves it out, after asking (`--yes` skips the question, `--check` only shows it), with the same backup and row count:

```
The project database is in the working tree, where a checkout or `git clean -X` can delete it. Jérôme 0.1.0 keeps it outside:
  move        .jerome/jerome.db → /Users/you/.local/share/jerome/projects/my-project-3f2a9c1b7d04/jerome.db
✓ Database moved to …/jerome.db: 23 runs, 218 usage, 0 usage_daily, 31 transcript_reads, 14 events, 2 requests, copied and checked; a backup is in …
```

Until then the database is still used where it is, and `jerome doctor` fails with the command to run.

## The `.jerome/project.json` file

`.jerome/project.json` is a JSON file:

```json
{
  "schema": "jerome.project/v1",
  "jerome": "0.1.0",
  "files": {
    ".claude/rules/jerome.md": "<sha-256>",
    ".claude/skills/project-brief/SKILL.md": "<sha-256>"
  }
}
```

- `schema` is the version of this file's format. Adding fields keeps it; renaming or removing fields bumps it.
- `jerome` is the version that last wrote it.
- `budgets`, `limits` and `heartbeat`, optional, hold the project's own token budgets, usage limits and schedule (see [lead-agent.md](../lead-agent.md#token-budget), [limits.md](../limits.md), [heartbeat.md](../heartbeat.md)). `jerome update` keeps them, like any field it does not manage.
- `files` holds, for each template file, the hash of the template version the project file was last reconciled with. A project file with that hash is unchanged since then; any other hash means it was changed in the project. File dates are not used, because git and copies change them.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Up to date, or the chosen files were updated |
| 1 | Not a Jérôme project, Jérôme's own repository, `.jerome/project.json` unreadable, with `--check` something is behind, or outside a terminal without `--yes` |
| 2 | Wrong usage |
