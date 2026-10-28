# `jerome governor`

The [quota governor](../quota-governor.md) of this machine (D141-D143). It starts fill runs while the subscription's week is behind its pace. It is off by default. Its settings and projects live in `~/.config/jerome/account.json`, not in a project.

```sh
jerome governor on [--target <n>] [--reserve <n>] [--five-hour-cap <n>]
jerome governor off
jerome governor add [dir]       # this project may be given fill runs
jerome governor remove [dir]
jerome governor status          # settings, the quota and the pace, the projects, what a run costs
```

| Option | Default | |
|---|---|---|
| `--target` | 90 | % of the 7-day window to reach by its reset |
| `--reserve` | 20 | % of the week kept for your own use, released evenly over its last 24 hours |
| `--five-hour-cap` | 90 | no heartbeat starts at or above this % of the 5-hour window |

The options go with `on`, which keeps the values not given. The watchdog runs the governor (`jerome watchdog install`). Turn it on on one Mac only: every Mac reads the same account.

See also [`jerome quota`](quota.md) and [`jerome heartbeat fill`](heartbeat.md#fill).
