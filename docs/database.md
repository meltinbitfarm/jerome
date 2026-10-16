# The project database

Every Jérôme project has one SQLite database for what happens in the project: runs, token usage, hook events and decision requests. There is no global database.

## Where it lives

Outside the project's folder, in `~/.local/share/jerome/projects/<name>-<hash>/jerome.db` (under `$XDG_DATA_HOME` if set). Agents switch branches all the time, at night too: a file in the working tree can be deleted by a checkout, as git removes ignored files that stand where it must put a tracked one, or by `git clean -X`. Out of the tree, no git command reaches it.

- **One per clone.** The hash is that of the clone's main folder, the parent of `git rev-parse --git-common-dir`. The worktrees of a clone share its database; two clones of the same repository have one each. Nothing about it is versioned.
- **A record next to it**, `record.json`: the folder it belongs to and the repository's fingerprint, its first commit and its `origin` remote. A database created before the first commit gets the fingerprint at the first write after it.
- **A project that moved** (renamed folder, moved elsewhere) has no database at its new path. Hooks record nothing, heartbeats do not start, and the status line says `no database: run jerome doctor`. `jerome doctor` finds the databases of the same repository whose folder no longer holds the project and asks which to relink. `--yes` relinks without asking only when there is one; with more, the choice is yours (`--relink <key>`). Nothing is created until you choose; `--new-db` starts an empty database instead.
- **A project that is gone** leaves its database: `jerome doctor` lists it in a warning, and never deletes it. [`jerome forget <key>`](commands/forget.md) removes it after a backup.
- **Projects from before** kept it in `.jerome/jerome.db`. It is still used there, so nothing is lost, until [`jerome update`](commands/update.md) moves it out with a backup and a row count of every table; `doctor` fails until then. `.jerome/jerome.db*` stays in `.gitignore`, so an older Jérôme never puts one in git.

## Who writes it

Only the CLI and the hooks. The model never runs SQL and never touches the file: tracking costs no tokens. The one exception is decision requests: the lead agent opens and closes them with [`jerome request`](commands/request.md), where the CLI writes and the model only passes the text. Hooks never make a session fail: on an error they exit quietly and record an `error` event if they can.

The hooks that write it are described in [hooks.md](hooks.md). The lead agent reads the database with [`jerome state`](commands/state.md).

## Tables

| Table | One row per |
|---|---|
| `runs` | session or run: kind (`interactive`, `heartbeat`, `service`), start and end, status (`running`, `done`, `failed`, `blocked`, `stopped`), reason, and the [area](areas.md) a heartbeat worked on |
| `usage` | API call, keyed by `request_id`: agent, model, input, output, cache reads, cache writes (5 minutes and 1 hour), time |
| `usage_daily` | day, agent and model, summing `usage` rows older than 90 days |
| `transcript_reads` | transcript, with how far it has been read |
| `events` | hook event: kind and numbers or names only, never message contents |
| `requests` | decision request: question, options, recommendation, status, answer, and the area it holds up |

Allowed values are checked by the schema itself. Model prices are not in the database: they live in the code (`src/models.js`), so a price change comes with a Jérôme update.

## Reading transcripts

Usage comes from Claude Code's transcripts (see [usage-data.md](usage-data.md)). Each transcript is read from where the last read stopped, so a hook reads only the new lines; a line still being written is left for the next read. A transcript shorter than its saved offset has been rewritten, and is read again from the start. Calls are deduplicated by `request_id`, keeping each field's largest value, since `output_tokens` grows across the lines of one response. Reading the same lines twice never changes the totals.

## Retention

- `usage` rows older than 90 days are summed into `usage_daily`, in the same transaction that deletes them, so totals never change. Transcript lines older than 90 days are never read again.
- `events` and `transcript_reads` rows older than 30 days are deleted.
- `runs` and `requests` are kept.

Pruning runs when a session starts.

## Migrations

The schema is versioned in SQLite's `user_version`. Numbered migrations in the package (`migrations/001-init.sql`, …) bring a database up to date, each in its own transaction, whenever the CLI opens it to write, and when `jerome new` or `jerome doctor` runs. Existing data is kept. A database created by a newer Jérôme is never written: `jerome doctor` fails its `db` check and asks you to update Jérôme.

The database runs in WAL mode, so hooks of subagents running in parallel can write at the same time. Node 24 still marks `node:sqlite` as experimental and prints a warning; the CLI drops that warning only, so it never ends up in a hook's output.

## Account data

The subscription is one, shared by every project, so its data is not in any project database. `~/.config/jerome/account.json` (or under `$XDG_CONFIG_HOME`) holds the latest reading of the 5-hour and 7-day windows, with when and where it was read, and the global limits:

```json
{
  "schema": "jerome.account/v1",
  "windows": {
    "five_hour": { "used": 43, "resetsAt": 1791998400, "readAt": "2026-10-15T12:05:00.000Z", "source": "statusline" },
    "seven_day": { "used": 10, "resetsAt": 1792548000, "readAt": "2026-10-15T12:05:00.000Z", "source": "statusline" }
  },
  "limits": { "five_hour": 80, "seven_day": 70 }
}
```

The status line and the scheduled runs (the lead agent and the triage, from the `rate_limit_event` of their streams) write it, only when a value changes, through a temporary file and a rename, so a reader never sees half a file. Global limits are set with [`jerome limits`](commands/limits.md); per-project limits live in the project's `.jerome/project.json`, see [limits.md](limits.md).
