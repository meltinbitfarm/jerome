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
| `usage` | tokens today (since local midnight) and over the last 7 days, with their API-equivalent price |
| `window` | the latest reading of the subscription's 5-hour and 7-day windows, its source and time, and the global limits, from `~/.config/jerome/account.json` |
| `agents` | tokens per agent over the last 7 days; `main` is the lead agent |
| `runs` | the latest runs: start, kind, status (with the reason when blocked) and tokens |
| `open` | the open decision requests |

Tokens count input, output and cache reads and writes. **Dollar amounts are API equivalents**, never a cost: a subscription is not billed per token. They are computed from the API list prices and always written as `≈$3.40 API`; `+?` means some calls used a model whose price Jérôme does not know.

| Option | Effect |
|---|---|
| `--runs <n>` | how many recent runs to list (default 3) |
| `--agent <name>` | only that agent's usage |
| `--replies` | adds a `replies` line: per agent, over 7 days, the average and longest reply in words and how many went over 150 (see [hooks.md](../hooks.md#reply-lengths)) |
| `--json` | the same data as one JSON object, schema `jerome.state/v1` |

`jerome state` is allowed by the project's permission rules, so the lead agent runs it without asking. See [database.md](../database.md) for where the data comes from.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | State shown |
| 1 | Not a Jérôme project, no database yet (run `jerome doctor`), or a database from a newer Jérôme |
| 2 | Wrong usage |
