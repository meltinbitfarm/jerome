# `jerome forget <key> [--yes]`

Removes the database of a project that is gone. Databases live outside the projects' folders (see [database.md](../database.md#where-it-lives)), so deleting a project's folder leaves its database behind. [`jerome doctor`](doctor.md) lists these databases in a warning, with their keys, the folder they belonged to and their runs, and never deletes them.

```sh
jerome forget my-project-3f2a9c1b7d04
```

- Only a database whose folder no longer holds a Jérôme project can be removed. If the project only moved, run `jerome doctor` in its new folder to relink it instead.
- It asks first, in a terminal; `--yes` skips the question. Outside a terminal and without `--yes`, nothing is removed.
- Before removing it, it copies the database to `~/.cache/jerome/backups/<key>-forgotten-<date>.db`.

| Exit code | Meaning |
|---|---|
| 0 | Removed, after the backup |
| 1 | No such database, its project is still in place, or not confirmed |
