# `jerome schedule [dir] hourly|daily|weekly`

Schedules [heartbeats](../heartbeat.md) for a project: runs of the lead agent without you, started by launchd on macOS. Nothing is scheduled by default.

```sh
jerome schedule daily --at 09:00
jerome schedule hourly --at :15 --max-tokens 300000 --max-turns 20
jerome schedule weekly --day fri --at 18:00
jerome schedule --list
jerome schedule --off
```

| Option | Effect |
|---|---|
| `--at` | the time, `09:00` by default; for `hourly` the minute, `:00` by default |
| `--day` | `mon` … `sun`, for `weekly` (default `mon`) |
| `--max-tokens` | token cap per run (default 500,000) |
| `--max-turns` | turn cap per run (default 40) |
| `--list` | the projects with a schedule on this machine |
| `--off` | removes the project's schedule and its launchd job |

Scheduling again replaces the previous schedule. The schedule and the caps are saved in `.jerome` under `heartbeat`; the launchd job, with the absolute paths of `node`, `jerome` and `claude`, lives in `~/Library/LaunchAgents/` and stays on your machine. `jerome doctor` checks it.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Scheduled, removed or listed |
| 1 | Not a Jérôme project, not macOS, `claude` not found, or launchd refused the job |
| 2 | Wrong usage |
