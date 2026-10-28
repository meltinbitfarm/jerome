# `jerome watchdog`

The job of this machine, apart from the heartbeats: one launchd job, `com.jerome.watchdog`, every 60 seconds (D134). Each pass, at zero tokens, for every project on the machine:

1. closes the runs whose process is gone ([lost runs](../heartbeat.md#lost-runs), D136);
2. tells you, once, about heartbeats that should have started and did not ([missed starts](../heartbeat.md#missed-starts), D135);
3. runs the [Telegram bridge](../telegram.md), when it is set up: your answers and notes in, the queue out.

```sh
jerome watchdog install     # write and load the job; again, it only refreshes it
jerome watchdog uninstall   # remove it
jerome watchdog status      # whether it is loaded
jerome watchdog run         # one pass, as the job runs it
```

Its log, `~/.cache/jerome/logs/watchdog.log`, gets a line only when something happened. `jerome telegram setup` installs it; `jerome doctor` suggests it in a project with heartbeat jobs when it is missing.
