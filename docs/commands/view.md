# `jerome view [dir]`

Opens a read-only page in the browser with what happens in a project: the team, the runs, usage and its API equivalent, the subscription windows, the open decision requests and the subagents' reply lengths. `dir` defaults to the current directory.

```
$ jerome view
Jérôme viewer for /Users/you/my-project
http://127.0.0.1:52817/?t=Qx1…
Read-only. Press Ctrl+C to stop.
```

| Option | Effect |
|---|---|
| `--port <n>` | listen on that port instead of a free one |
| `--no-open` | print the address without opening the browser |

## What the page shows

- **Limits:** the subscription's 5-hour and 7-day windows with the time and source of the reading (a window that has reset since shows `no reading since its reset`, without the old figure), each as a bar next to its global threshold from `~/.config/jerome/account.json` (`7d 20% / 70%`): green below 75% of the threshold, yellow from 75%, red from 90%, red and bold beyond it. Below them, the project's spend today and this week against its limits, with the same colours.
- **Totals** for today, 7 and 30 days, in tokens and API equivalent, and the number of open decision requests.
- **Areas**, when the project has `areas.md`: each [area](../areas.md) with its milestone and criteria, pace, priority, last heartbeat, whether it is active, paused or waiting for a request (linked to its run), and its usage over 7 days with a bar, then the `shared` usage.
- **Decision requests** with their options and recommendation, each linked to its run.
- **Team:** the lead agent with the models it used, then the project's agents from `.claude/agents/` with their model and tools, then agents that appear in the usage without a file, such as `general-purpose`, marked built-in. Each with its usage over 7 days and its reply lengths.
- **Runs:** the latest 50 with kind, area, status, duration, tokens, API equivalent and the agents involved, filtered by kind and, with areas, by area. Opening a run shows its usage per agent and model, the lead agent's calls (for each one, the context it sent, its output and the tools it used, with the file or command they touched: every call pays for the whole context again, so this is where a session's cost shows), the chained commands the hook refused, hook errors, and each delegation: the agent, the task the lead agent gave it and its reply, both closed by default. Tasks and replies are read at that moment from Claude Code's transcripts and are never stored by Jérôme. A service run, or a run whose transcript was deleted, shows usage only.
- **Usage by agent and model** for today, 7 or 30 days, with cache reads and cache writes in separate columns, since on the API they cost very differently, and each row's share of the API equivalent as a bar.
- **Reply lengths** per agent over 7 days, against the 150-word limit. An agent with no reply recorded yet shows "no data yet".

The page looks like a terminal: one monospaced system font and no web fonts, each section titled with the command that prints the same data (`$ jerome limits`, `$ jerome state --runs 50`), bars drawn with block characters, where a vertical line marks the limit, and terminal colours for levels and statuses: green, yellow, red, and cyan for what is running. Nothing on it moves.

Dollar amounts are always API equivalents, written `≈$3.40 API`, or `<$0.01 API` below a cent: a subscription is not billed per token. The theme follows the system; the menu in the header switches it, and the browser remembers the choice. The page checks for changes every 10 seconds while its tab is visible, and the server answers "not modified" when nothing changed. `#run-<id>` at the end of the address opens that run.

## Safety

- The server listens on `127.0.0.1` only. Every request must carry the token printed in the address, which changes at every start, and come for `127.0.0.1` or `localhost`: a web page in your browser or another user of the machine cannot read the data through the port.
- It only answers `GET`, and never writes: it opens the database read-only, without migrations, and touches neither `account.json`, the transcripts nor any setting. If the database is behind this Jérôme's schema, the page says to run `jerome doctor`.
- Every text from a transcript is shown as text, never interpreted as HTML.
- Stopping the viewer with Ctrl+C affects nothing else: runs and hooks never depend on it.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Stopped with Ctrl+C |
| 1 | Not a Jérôme project, no database yet (run `jerome doctor`), or the port is taken |
| 2 | Wrong usage |
