# `jerome heartbeat`

The autonomous runs of a project: one run, its jobs, how they are going, and a run of runs. See [heartbeat.md](../heartbeat.md) for every step and guarantee.

```sh
jerome heartbeat [dir]                       # one run, as launchd starts a `jerome schedule` job
jerome heartbeat run <slot> [dir]            # one run of a slot, as its job starts it
jerome heartbeat install [dir]               # load the jobs, one per slot
jerome heartbeat uninstall [dir]             # remove them, keep the settings
jerome heartbeat status [dir] [--runs <n>]   # jobs, the run going on, alerts, the latest runs
jerome heartbeat marathon --until <HH:MM> [dir]
jerome heartbeat override --today [dir]
```

`dir` defaults to the current folder. A folder named like a subcommand is given as `./status`.

## One run

`jerome heartbeat [dir]` and `jerome heartbeat run <slot> [dir]` go through the lock, the checks, the start state, doctor, the limits, the zero-token check and the triage (or straight to the lead agent in RESUME mode), then the lead agent within its caps and max duration, and the end check. A slot's text is added to the triage and the lead agent's prompt.

| Option | Effect |
|---|---|
| `--max-tokens <n>` | token cap for this run only, in place of the project's |
| `--max-turns <n>` | turn cap for this run only, in place of the project's |

They change neither `.jerome/project.json` nor the jobs: a run stopped on one of them says so, as in `token cap: 61,204 tokens over 50,000 (this run; main 21k, developer 40k)`. Use them to try an area at a small cost, or to see the caps stop a real run.

It prints one line, written to the project's log as well:

```
2026-10-27T21:00:42Z claude-watch done [normal, slot evening, 14 min, exit 0, end check ok]: development: Write the report writer
```

Run by hand on a terminal, it shows a progress line on standard error for the doctor check, the triage and the lead agent. Ctrl+C stops the lead agent and its whole process tree, and records the run as `stopped: interrupted`.

The run's status is `done`, `blocked` (a check said no, or the lead agent was refused a tool it needed), `stopped` (a cap, the max duration, an interrupt) or `failed` (the triage, Claude Code, or the end check), with the reason. It exits with 0 once the run is recorded, and with 1 only when the folder is not a Jérôme project with a database.

## install, uninstall

`install` writes and loads one launchd job per slot of `heartbeat.slots` in `.jerome/project.json`, or the job of `jerome schedule` when there are no slots, and removes the project's jobs that its settings no longer list. Under each slot it prints what that slot's runs are allowed beyond the project's permission rules (the `test` command, `heartbeat.allow` and the slot's `allow`; see [permissions](../heartbeat.md#permissions)). Running it again changes nothing. It exits with 2, changing nothing, when the settings have a problem (each is listed) or when there is nothing to schedule. `uninstall` removes every job of the project and leaves its settings.

## status

```
$ jerome heartbeat status
claude-watch · heartbeats
jobs     morning 09:00 (loaded) · evening 18:00, 21:30 on mon, tue, wed, thu, fri (loaded)
now      no heartbeat running
alerts   1 open, 1 run lost: tell the user
  A4 end check: ended on branch agent/report, not main; next run resumes · 1 run lost since 2026-10-27 21:14
runs     last 3
  2026-10-27 21:00 failed [normal, evening, 14 min, exit 0, end check failed] end check: ended on branch agent/report, not main; …
  2026-10-27 18:00 done [normal, evening, 22 min, exit 0, end check ok] development: …
  2026-10-27 09:00 done [normal, morning, 0 min] no changes since the last heartbeat
log      ~/.cache/jerome/logs/claude-watch-1a2b3c4d.log
```

It also shows a `resume` line when the next run will resume half-done work, and a `limits` line while they are lifted for the day. `--runs <n>` lists more runs (default 8). It reads only the database and the job files: zero tokens.

## marathon

`--until HH:MM` runs heartbeats back to back until that time of the day it started, `24:00` being midnight: never into the next day, and not at all when started after it. 2 minutes between runs where the lead agent worked, 30 after a skip, a failure or no work; it waits while another heartbeat holds the lock. It holds the terminal until it ends.

## override

`--today` lifts the global and project limits on this project's heartbeats until local midnight. It is kept on this machine (`~/.cache/jerome/heartbeat/`), not in the project.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the run is recorded; the command did what it says |
| 1 | not a Jérôme project, no database, not macOS for `install`, or launchd refused a job |
| 2 | wrong usage, settings with problems, nothing to install, or a marathon whose time has passed |
