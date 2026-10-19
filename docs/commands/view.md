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
- **Totals** for today, 7 and 30 days, in tokens and API equivalent, the number of open decision requests and of assumptions to confirm.
- **Areas**, when the project has `areas.md`: each [area](../areas.md) with its milestone and criteria, pace, priority, last heartbeat, whether it is active, paused or waiting for a request (linked to its run), and its usage over 7 days with a bar, then the `shared` usage.
- **Decision requests** with their options and recommendation, each linked to its run, a milestone request marked as holding its area, then the [assumptions](../lead-agent.md#questions-and-assumptions) of `open.md` to confirm.
- **Team:** the lead agent with the models it used, then the project's agents from `.claude/agents/` with their model and tools, then agents that appear in the usage without a file, such as `general-purpose`, marked built-in. Each with its usage over 7 days and its reply lengths.
- **Runs:** the latest 50 with kind, area, status, duration, tokens, API equivalent and the agents involved, filtered by kind and, with areas, by area. Opening a run shows the triage's verdict for a heartbeat (the area, the task and why), its usage per agent and model, the lead agent's calls (for each one, the context it sent, its output and the tools it used, with the file or command they touched: every call pays for the whole context again, so this is where a session's cost shows), the chained commands the hook refused, hook errors, and each delegation: the agent, the task the lead agent gave it and its reply, both closed by default. Tasks and replies are read at that moment from Claude Code's transcripts and are never stored by Jérôme. A service run, or a run whose transcript was deleted, shows usage only.
- **Usage by agent and model** for today, 7 or 30 days, with cache reads and cache writes in separate columns, since on the API they cost very differently, and each row's share of the API equivalent as a bar.
- **Reply lengths** per agent over 7 days, against the 150-word limit. An agent with no reply recorded yet shows "no data yet".

The page looks like a terminal: one monospaced system font and no web fonts, each section titled with the command that prints the same data (`$ jerome limits`, `$ jerome state --runs 50`), bars drawn with block characters, where a vertical line marks the limit, and terminal colours for levels and statuses: green, yellow, red, and cyan for what is running. Nothing on it moves, except the lines of a live view, and only with what happens (see below).

Dollar amounts are always API equivalents, written `≈$3.40 API`, or `<$0.01 API` below a cent: a subscription is not billed per token. The theme follows the system; the menu in the header switches it, and the browser remembers the choice. The page checks for changes every 10 seconds while its tab is visible, and the server answers "not modified" when nothing changed. `#run-<id>` at the end of the address opens that run, `#live-<id>` the live view of one in progress.

## A run in progress

Opening a run that is still `running` opens its live view (`#live-<id>` at the end of the address), in place of the page; `← runs` goes back. It shows only what Jérôme measures, read from the session's transcripts and the database:

```
← runs  live · run 182 · heartbeat · development                    ● running 4:12

                  ┌ main · lead agent ─────────────────────────────┐
                  │ claude-opus-5-5 · running                      │
                  │ last call 10:41:07 · context 61k · output 1.2k │
                  │ waiting for developer                          │
                  └───────────────────────┬────────────────────────┘
             ┌────────────────────────────┼────────────────────────────┐
┌ analyst ───┴─────────────┐ ┌ developer ─╎─────────────┐ ┌ researcher ╎ background ┐
│ claude-sonnet-5-5 · done │ │ claude-opus-5-5 · running│ │ claude-sonnet-5-5 · running │
│ Review the criteria of v1│ │ Fix the parser           │ │ Read the hooks page         │
│ 41k tokens · ended 10:39 │ │ 112k tokens · last 10:41 │ │ 40k tokens · last 10:40     │
└──────────────────────────┘ └──────────────────────────┘ └─────────────────────────────┘

# log · run 182
10:40:01  main       delegate  → developer: Fix the parser
10:40:33  developer  Edit      src/parse.js
10:41:01  developer  blocked   git add && git commit (chained commands refused)

area development · agents running 2 · 4:12 · 370k / 500k tokens ████████▏░░│ 74% · turns cap 40
```

- **The lead agent:** the run's status, its model, the context and output of its last call and when, and `waiting for <agent>` while a subagent in the foreground has not returned.
- **Each subagent of the run:** its type (`developer 2` when there are two), its model, the task's description, `starting`, `running`, `done` or `ended` (the run ended first), its tokens and its last activity. One in the foreground is done when its result reaches the lead agent; one in the background when it hands back.
- **The lines** from the lead agent to each subagent move only with what happens: the line to an agent at work flows, a short pulse runs back to the lead agent when its result arrives, and a finished agent's line is still and fainter. With the system's reduced motion setting, nothing moves: only the colours change.
- **The log**, oldest first, of every agent's calls with time, agent, and tool with what it touched, the delegations, results and handbacks, the chained commands the hook refused and hook errors; the latest 200 lines.
- **The status bar:** the area, the agents running, the elapsed time, and the run's tokens counted from the transcripts as the heartbeat counts them, against its token cap (the caps a heartbeat ran with are kept with its run). The turn cap is shown as a number: turns are not counted while the run goes on. An interactive session has no cap.

There is no progress bar and no estimate: Jérôme does not know how far a task has gone, nor how full a model's context window is. The view asks the server every 2 seconds while the run is running and the tab is visible, and stops once the run ends, showing its final status. The server reads each transcript from where it stopped, keeps that in memory only, and forgets a run 5 minutes after it was last asked for.

## All the projects

[`jerome projects --view`](projects.md) serves one page with every project of the machine; each project's name opens this same page for it, under `/p/<key>/`, with a link back to the overview.

## Safety

- The server listens on `127.0.0.1` only. Every request must carry the token printed in the address, which changes at every start, and come for `127.0.0.1` or `localhost`: a web page in your browser or another user of the machine cannot read the data through the port.
- It only answers `GET`, and never writes: it opens the database read-only, without migrations, and touches neither `account.json`, the transcripts nor any setting. If the database is behind this Jérôme's schema, the page says to run `jerome doctor`.
- Every text from a transcript is shown as text, never interpreted as HTML.
- Stopping the viewer with Ctrl+C affects nothing else: runs and hooks never depend on it.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Stopped with Ctrl+C |
| 1 | Not a Jérôme project (it points to [`jerome projects`](projects.md)), no database yet (run `jerome doctor`), or the port is taken |
| 2 | Wrong usage |
