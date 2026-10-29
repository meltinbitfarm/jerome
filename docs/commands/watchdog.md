# `jerome watchdog`

The job of this machine, apart from the heartbeats: one launchd job, `com.jerome.watchdog`, every 60 seconds (D134). Each pass, at zero tokens, for every project on the machine:

1. closes the runs whose process is gone ([lost runs](../heartbeat.md#lost-runs), D136);
2. tells you, once, about heartbeats that should have started and did not ([missed starts](../heartbeat.md#missed-starts), D135);
3. with the [quota governor](../quota-governor.md) on, reads the subscription's quota (at most every 5 minutes) and, while the week is behind its pace, starts fill runs in the governor's projects, at most one per project, a new one at least 5 minutes after the last and on a fresh reading (D142, D144);
4. has the texts of each project's [board](../board.md) that are new rewritten in plain words, by a worker apart (D177);
5. sends its signed beat to [Jérôme Director](../director.md), when this Mac is connected (D148), with the boards that changed;
6. keeps the [Telegram bridge](../telegram.md)'s listener running, when the bridge is set up: it starts one when none runs (D184).

```sh
jerome watchdog install     # write and load the job; again, it only refreshes it
jerome watchdog uninstall   # remove it
jerome watchdog status      # whether it is loaded
jerome watchdog run         # one pass, as the job runs it
```

Its log, `~/.cache/jerome/logs/watchdog.log`, gets a line only when something happened. `jerome telegram setup` installs it; `jerome doctor` suggests it in a project with heartbeat jobs when it is missing.
