# `jerome schedule [dir] hourly|daily|weekly`

Schedules [heartbeats](../heartbeat.md) for a project: runs of the lead agent without you, started by launchd on macOS. Nothing is scheduled by default.

```sh
jerome schedule daily --at 09:00
jerome schedule hourly --at :15 --max-tokens 300000 --max-turns 20
jerome schedule weekly --day fri --at 18:00 --model sonnet
jerome schedule --list
jerome schedule --off
```

| Option | Effect |
|---|---|
| `--at` | the time, `09:00` by default; for `hourly` the minute, `:00` by default |
| `--day` | `mon` … `sun`, for `weekly` (default `mon`) |
| `--max-tokens` | token cap per run (default 500,000) |
| `--max-turns` | turn cap per run (default 40) |
| `--model` | the lead agent's model in heartbeats: `opus` (default), `sonnet`, `haiku`, a full model id, or `default` to go back to Opus; the triage always runs on Haiku |
| `--list` | the projects with a schedule on this machine |
| `--off` | removes the project's schedule and its launchd job |

It is the shorthand for one run at a fixed time. For several runs a day, or different work at different times, give the project slots and run [`jerome heartbeat install`](heartbeat.md#install-uninstall) instead; `schedule` refuses a project that has slots. `--off` removes every job of the project, slots included, and the schedule, keeping the other settings of its runs.

Scheduling again replaces the previous schedule and caps, and keeps the model and the other settings of `heartbeat` unless `--model` is given. The schedule and the caps are saved in `.jerome/project.json` under `heartbeat`; the launchd job, with the absolute paths of `node`, `jerome` and `claude`, lives in `~/Library/LaunchAgents/` and stays on your machine. `jerome doctor` checks it.

The schedule is the project's: each heartbeat works on one of its [areas](../areas.md), chosen by priority among those whose own pace has come round. An area paced more often than the heartbeats run (an `hourly` area with daily heartbeats) gets at most one per heartbeat; `schedule` and `jerome doctor` point it out.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Scheduled, removed or listed |
| 1 | Not a Jérôme project, not macOS, `claude` not found, or launchd refused the job |
| 2 | Wrong usage |
