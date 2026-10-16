# `jerome projects`

Shows every Jérôme project on this machine, from any folder, with the ones that need you first. It costs no tokens and starts no agent: it reads the [database](../database.md) registry and, for each project, the same data as [`jerome state`](state.md), read-only.

```
$ jerome projects
jerome projects · 3 projects, 1 needs you
account 5h 34%/70% · 7d 81%/75% (warn)

! listo  ~/Projects/listo
    1 open decision request: R4
    heartbeat blocked: uncommitted changes (src/app.js)

  PROJECT     AREAS                           REQ  LAST HEARTBEAT       7 DAYS       FOLDER
! listo       development v1, marketing beta  1    2 hours ago blocked  1.4M ≈$2.10  ~/Projects/listo
  site        —                               0    19 hours ago done    320k ≈$0.48  ~/Projects/site
  notes       —                               0    not scheduled        12k ≈$0.02   ~/Projects/notes
```

| Option | Effect |
|---|---|
| `--json` | the same as one JSON object, schema `jerome.projects/v1`: `windows`, then `projects`, each with `key`, `name`, `path`, `areas`, `requests`, `lastHeartbeat`, `lastActivity`, `week`, `projectLimits`, `schedule`, `attention` (its reasons) and `error`, then `orphans` |
| `--view` | the same as a page in the browser, in the style of [`jerome view`](view.md); with `--port <n>` and `--no-open` as there |

## What needs you

A project comes first, with its reasons, when:

- it has **open decision requests**;
- its last heartbeat **failed**, or was **stopped** by its token or turn cap;
- its last heartbeat was **blocked** by something only you can clear: uncommitted changes, a folder not trusted in Claude Code, a provisional `PROJECT.md`, `jerome doctor` failing, or no commit yet. A lock, an open session or a pause for a limit clear by themselves and are not listed here; a pause shows in the limits;
- its spend today or this week is at **75% or more of its limit** (the `warn` level, as in the viewer and the status line);
- its database **cannot be read**, or needs `jerome doctor` for its schema;
- it has a heartbeat scheduled but **none ran in twice its interval**: `no heartbeat for 3 days (scheduled every day at 09:00)`. With no heartbeat at all, the time since the launchd job was written counts.

The other projects follow, the most recently active first. The subscription windows belong to the account, not to a project: they are shown once, at the top.

## What it lists

Every database in `~/.local/share/jerome/projects/` (under `XDG_DATA_HOME` if set). One row per clone: worktrees of a clone share its database, so they share its row, and two clones of the same repository have one row each, told apart by their folder.

A database whose folder no longer holds a project, because the project moved or was deleted, is listed below the table with the hints of [`jerome doctor`](doctor.md): run `jerome doctor` in the new folder to relink it, or `jerome forget <key>` to remove it after a backup. Nothing is hidden and nothing is removed.

A project with no database yet does not appear: `jerome doctor` in its folder creates one. The same goes for a database still in the project's `.jerome/` folder from before Jérôme moved it out: `jerome update` moves it.

## The page

`jerome projects --view` serves the overview on `127.0.0.1`, with the same safety as `jerome view`: a token that changes at every start, `GET` only, nothing written. Each project's name opens its own viewer at `/p/<key>/`, the key being its database's name in the registry: no folder path ever goes in the address, and a database without a project is not served. That page has a link back to the overview.

## Commands about one project

`jerome state` and `jerome view` show one project. Outside a project they stop and point here:

```
$ jerome state
/Users/you is not a Jérôme project (.jerome/project.json is missing).
All the projects of this machine: `jerome projects`.
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Projects shown, or the page stopped with Ctrl+C |
| 1 | The registry cannot be read, or the port is taken |
| 2 | Wrong usage: a folder, or `--json` with `--view` |
