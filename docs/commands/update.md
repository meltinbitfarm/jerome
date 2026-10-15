# `jerome update [dir]`

Brings the template files of an existing project up to the installed Jérôme version. `jerome new` copies the template only once, so this is how fixes to the lead agent's instructions or to the briefing skill reach projects created earlier.

```sh
npm install -g github:meltinbitfarm/jerome   # update Jérôme first
jerome update                                # in the project folder
```

## What it touches

Only the paths listed in the template's `MANIFEST`: today `CLAUDE.md`, the `project-brief` skill and the `MANIFEST` itself. Project state is never touched, and a `MANIFEST` that listed it would be refused: `PROJECT.md`, `scope.md`, `decisions.md`, `open.md`, `archive.md`, `brief.md`, `.jerome` and `.claude/settings.local.json`.

Rules that belong to one project go in `PROJECT.md` under `## Project rules`, never in `CLAUDE.md` or other template files (see [lead-agent.md](../lead-agent.md#project-rules)). That way updates never conflict with them.

## How it decides

Each template file in the project falls into one of these cases:

| Status | Meaning | What happens |
|---|---|---|
| `update` | Unchanged since it was copied, and the template has changed | Replaced, after one confirmation for all such files |
| `new` | Added to the template since the project was created | Copied, with the same confirmation |
| `changed here` | Changed in the project, and the template has changed too | Replaced only if you confirm that file on its own |
| up to date | Same as the template, or changed here and already kept against this template version | Nothing |

Before asking, it prints the list and a diff of each file, from the project's version (`project/…`) to the template's (`template/…`).

If you keep a file you changed, the choice is remembered: it is not offered again until the template changes that file once more.

Files under a template path that the template no longer has are reported and left in place, never deleted. Delete them yourself if you don't need them.

In Jérôme's own repository, recognized by its `package.json` and `template/MANIFEST`, the command refuses to run: the template there is the source, not a copy.

## Options

- `--check` shows the list and the diffs and writes nothing. It exits with 1 when something is behind, so scripts can use it.
- `--yes` applies the `update` and `new` files without asking. Files changed in the project are left as they are and reported: run `jerome update` in a terminal to choose for them.

Without `--yes` and outside a terminal, nothing is written.

`jerome doctor` warns when template files are behind the installed version, without failing.

## The `.jerome` file

`.jerome` is a JSON file:

```json
{
  "schema": "jerome.project/v1",
  "jerome": "0.1.0",
  "files": {
    "CLAUDE.md": "<sha-256>",
    "MANIFEST": "<sha-256>"
  }
}
```

- `schema` is the version of this file's format. Adding fields keeps it; renaming or removing fields bumps it.
- `jerome` is the version that last wrote it.
- `budgets`, optional, sets the project's own token budgets (see [lead-agent.md](../lead-agent.md#token-budget)). `jerome update` keeps it, like any field it does not manage.
- `files` holds, for each template file, the hash of the template version the project file was last reconciled with. A project file with that hash is unchanged since then; any other hash means it was changed in the project. File dates are not used, because git and copies change them.

Projects created before this file existed have an empty `.jerome`. For them, every template file that differs from the installed template counts as changed in the project, and the first `jerome update` writes the record.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Up to date, or the chosen files were updated |
| 1 | Not a Jérôme project, Jérôme's own repository, `.jerome` unreadable, with `--check` something is behind, or outside a terminal without `--yes` |
| 2 | Wrong usage |
