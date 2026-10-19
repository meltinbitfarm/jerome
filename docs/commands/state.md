# `jerome state [dir]`

Shows a project's usage, runs and open decision requests, in a few lines. It is what the lead agent reads when you ask how the project is going, so it is kept to about 150 tokens. `dir` defaults to the current directory.

```
$ jerome state
claude-watch · state at 2026-10-15 13:37
usage   today 3.3M (in 242 · out 44k · cache 3.2M) ≈$2.35 API · 7d 4.3M ≈$3.21 API
window  no reading yet
agents  7d: main 4M · developer 140k · analyst 108k · documentarist 50k
runs    last 3: 12:46 interactive done 2.5M · 12:33 interactive done 89k · 12:08 interactive done 94k
open    no decision requests
```

| Line | What it shows |
|---|---|
| `usage` | tokens today (since local midnight), split into input, output, cache reads and cache writes, and over the last 7 days, with their API-equivalent price |
| `window` | the latest reading of the subscription's 5-hour and 7-day windows, its source and time, and the global limits, from `~/.config/jerome/account.json`; a window that has reset since its reading shows `no reading since its reset at 20:00`, never the old figure, and is not checked against its limit |
| `limits` | the project's spend today and this week against its limits |
| `paused` | present while heartbeats are paused by a limit, with the reason |
| `areas` | each [area](../areas.md) with its milestone, `paused` or the milestone request it waits for, and its usage over 7 days, then the `shared` usage; left out when the project has no `areas.md` |
| `agents` | tokens per agent over the last 7 days; `main` is the lead agent |
| `runs` | the latest runs: start, kind, area, status (with the reason when blocked) and tokens |
| `open` | the open decision requests, followed by how to record an answer (`jerome request answer <id> "<answer>"`) |
| `assumed` | the assumptions of `open.md` waiting for you (see [lead-agent.md](../lead-agent.md#questions-and-assumptions)), followed by how to record them; left out when there are none |

Tokens count input, output and cache reads and writes. **Dollar amounts are API equivalents**, never a cost: a subscription is not billed per token. They are computed from the API list prices and always written as `≈$3.40 API`, or `<$0.01 API` below a cent; `+?` means some calls used a model whose price Jérôme does not know. Cache reads and writes are kept apart (`cacheRead`, `cacheWrite` in `--json`, with `cache` their sum), since on the API a read costs a tenth of an input token and a write more than one.

| Option | Effect |
|---|---|
| `--runs <n>` | how many recent runs to list (default 3) |
| `--agent <name>` | only that agent's usage |
| `--replies` | adds a `replies` line: per agent, over 7 days, the average and longest reply in words and how many went over 150 (see [hooks.md](../hooks.md#reply-lengths)) |
| `--json` | everything `jerome state` knows as one JSON object, schema `jerome.state/v1`: besides the lines above, the latest runs with duration and API equivalent, usage per agent and model for today, 7 and 30 days (`byModel`), reply lengths (`replies`), the team (`team`), the areas (`areas`, each with its lines, `lastHeartbeat`, `request` and `week` usage, `areasImplicit` when there is no `areas.md`) and the `shared` usage, each run's and request's `area`, each request's `kind` (`milestone` or `question`), the `assumptions` (`id`, `text`), each heartbeat's `triage` verdict and `caps`, the latest heartbeat (`lastHeartbeat`: its `status`, `reason`, `area` and times), a `stale` flag on each window, and `projectLimits`: for `daily` and `weekly`, the `limit`, the spend in `usd` and `tokens`, `since`, `resetsAt` and the `level` (`ok`, `warn`, `high`, `over`). It is what [`jerome view`](view.md) shows. |

`jerome state` is allowed by the project's permission rules, so the lead agent runs it without asking. See [database.md](../database.md) for where the data comes from.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | State shown |
| 1 | Not a Jérôme project (it points to [`jerome projects`](projects.md)), no database yet (run `jerome doctor`), or a database from a newer Jérôme |
| 2 | Wrong usage |
