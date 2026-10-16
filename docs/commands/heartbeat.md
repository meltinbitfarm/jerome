# `jerome heartbeat [dir] [--max-tokens <n>] [--max-turns <n>]`

One scheduled run, as launchd starts it: lock, checks, global limits, the zero-token check, the triage, and only then the lead agent within its caps. See [heartbeat.md](../heartbeat.md) for every step. You can run it by hand to try a project's heartbeat.

| Option | Effect |
|---|---|
| `--max-tokens <n>` | token cap for this run only, in place of the project's |
| `--max-turns <n>` | turn cap for this run only, in place of the project's |

They change neither `.jerome/project.json` nor the launchd job: a run stopped on one of them says so, as in `token cap: 61,204 tokens over 50,000 (this run; main 21k, developer 40k)`. Use them to try an area at a small cost, or to see the caps stop a real run.

It prints one line, which launchd appends to the job's log:

```
2026-10-15T12:24:42Z claude-watch done: no work: the next step depends on the open decision request R2
```

Run by hand on a terminal, it shows a progress line on standard error for the doctor check, the triage and the lead agent, with what the lead agent is doing and the tokens so far. Under launchd there is no terminal, so the log gets only its one line.

The run's status is `done`, `blocked` (a check said no), `stopped` (token or turn cap) or `failed`, with the reason. It always exits with 0 once the run is recorded, and with 1 only when the folder is not a Jérôme project with a database.
