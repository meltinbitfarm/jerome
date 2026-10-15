# `jerome heartbeat [dir]`

One scheduled run, as launchd starts it: lock, checks, global limits, the zero-token check, the triage, and only then the lead agent within its caps. See [heartbeat.md](../heartbeat.md) for every step. You can run it by hand to try a project's heartbeat.

It prints one line, which launchd appends to the job's log:

```
2026-10-15T12:24:42Z claude-watch done: no work: the next step depends on the open decision request R2
```

The run's status is `done`, `blocked` (a check said no), `stopped` (token or turn cap) or `failed`, with the reason. It always exits with 0 once the run is recorded, and with 1 only when the folder is not a Jérôme project with a database.
