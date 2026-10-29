# Heartbeats

A heartbeat is a scheduled run of the lead agent: it does one task without you, on a branch, and leaves a decision request when it needs you. Nothing runs by default. You schedule heartbeats per project, with a cap per run, and Jérôme guarantees what no ad-hoc script did: no run is skipped silently, a half-done run is finished or dropped before anything new, every run is checked when it ends, and anything wrong reaches you first.

## Scheduling

The simplest schedule is one run at a fixed time:

```sh
cd my-project
jerome schedule daily --at 09:00                 # every day at 09:00
jerome schedule hourly --at :15 --max-tokens 300000
jerome schedule weekly --day fri --at 18:00
jerome schedule --list                           # the scheduled projects
jerome schedule --off                            # stop
```

| Option | Default |
|---|---|
| `hourly`, `daily`, `weekly` | none: one is required |
| `--at` | `09:00`, or `:00` for hourly |
| `--day` | `mon`, for weekly |
| `--max-tokens` | 500,000 tokens per run, counted as in `jerome state` (cache included). Normal runs on a real project took 90,000 to 340,000. |
| `--max-turns` | 40 turns per run |

### Slots

A project that runs several times a day, or wants different work at different times, has **slots** instead: each a name, one or more times, optionally days, and optionally a text added to that run's triage and lead agent prompt. They live with the other settings of its runs, under `heartbeat` in `.jerome/project.json`:

```json
"heartbeat": {
  "slots": [
    { "name": "morning", "at": ["09:00"] },
    { "name": "evening", "at": ["18:00", "21:30"], "days": ["mon", "tue", "wed", "thu", "fri"], "text": "Polish copy and fix small bugs only." },
    { "name": "results", "at": ["07:30"], "text": "Import yesterday's results with tools/import.sh.", "allow": ["Bash(./tools/import.sh:*)"] }
  ],
  "mainBranch": "main",
  "workBranch": "agent/*",
  "maxMinutes": 90,
  "test": "npm test",
  "allow": ["Bash(./tools/fetch-results.sh:*)", "WebFetch(domain:example.org)"],
  "quota": { "fiveHour": 70, "sevenDay": 80 },
  "alerts": { "command": "curl -fsS -d @- \"$(cat ~/.config/jerome/ntfy-url)\"" },
  "maxTokens": 500000,
  "maxTurns": 40
}
```

| Setting | Default | What it does |
|---|---|---|
| `slots` | none | `name` (lower case, digits, dashes), `at` (`"09:00"`, or `"*:15"` for every hour at :15), `days` (`mon` … `sun`; every day without it), `text`, `allow` (that slot's own [permission rules](#permissions)) |
| `mainBranch` | `main` | where every run must end |
| `workBranch` | `agent/*` | the pattern of the lead agent's branches; a `*` is required |
| `maxMinutes` | 90 | hard limit on a run's length, after which its whole process tree is stopped |
| `test` | none | the command the lead agent verifies with before merging, allowed in every run; without it, "the project's tests" |
| `allow` | none | permission rules for every run, beyond the project's own: see [permissions](#permissions) |
| `quota` | the global limits | this project's own thresholds on the 5-hour and 7-day windows, in % |
| `alerts.command` | none | the push channel for [alerts](#alerts); see there |
| `prompt` | none | one more line added to every run's lead agent prompt |

Then load the jobs, one per slot:

```sh
jerome heartbeat install      # writes and loads them; again, it changes nothing
jerome heartbeat status       # jobs, the run going on, alerts, the latest runs
jerome heartbeat uninstall    # removes them, keeps the settings
```

`install` refuses settings it cannot use, with what to fix, lists what each slot's runs are allowed beyond the project's rules, and removes the jobs of slots you took out; `jerome doctor` reports both too. `jerome schedule` stays the shorthand for a single run and refuses a project with slots. Ask the lead agent to change the slots: it edits `project.json` and runs `install`.

## How it is started

Heartbeats run on macOS through launchd: each job is a file in `~/Library/LaunchAgents/`, loaded with `launchctl`. launchd loads no shell profile, so a `node` installed with nvm would not be found: the job holds the absolute paths of `node`, `jerome` and `claude` found when you installed it, and a `PATH` built from their folders, Homebrew's and the system's, so the lead agent finds `jerome`, `git` and the project's test command too. These paths stay in the job, on your machine; `.jerome/project.json` only holds the settings. If you switch Node version or move Claude Code, `jerome doctor` reports the broken path with the command to install again. A heartbeat missed while the Mac slept runs once when it wakes.

The scheduler is reached through one small interface in `src/schedule.js` (write, remove, loaded, installed); launchd is the only one so far, and another (systemd timers, cron) takes its place by giving the same functions.

Each project has one log, `~/.cache/jerome/logs/<project>.log`: one line per run, with its status, mode, slot, length, exit code and end check, whether launchd or you started it.

## What a heartbeat does

`jerome heartbeat` (or `jerome heartbeat run <slot>`) goes through these steps, and stops at the first one that says no. Every heartbeat leaves one run in the [database](database.md), with its status, reason, mode, slot, exit code and end check, visible in `jerome heartbeat status`, `jerome state` and `jerome view`. None is ever skipped silently: see [alerts](#alerts).

1. **Lock.** One heartbeat per project at a time: a second one stops with "locked". A lock left by a process that no longer exists is taken over.
2. **Checks**, each opening a decision request when you have to act, once until you answer it: the folder is trusted in Claude Code, which otherwise ignores the project's allow rules, and `PROJECT.md` is not provisional.
3. **Start state.** Where the repository is decides the run's mode:
   - on `main` with a clean tracked tree: a **normal** run;
   - on `main` with uncommitted changes to Jérôme's own files only: the lead agent's state files (the Markdown files of `.jerome/`, such as `open.md`, `decisions.md`, `archive.md`, `digest.md`, and `.jerome/notes/`), `.jerome/project.json`, and `.claude/settings.json`, where `jerome doctor` keeps the hooks and the status line. The run **commits them first**, by name, as `State: carried over from the interactive session`, and goes on as a normal run (D127, D158). What doctor writes at the start of the run, and Jérôme's files left uncommitted on `main` at its end, are committed the same way, as `Jérôme: its own files, committed by the runner`. Any other changed file, even one alongside them, still skips the run with an alert, and nothing is committed;
   - on a work branch (`agent/*`), or with what a heartbeat left behind (a dirty tree, a merge or rebase in progress, a branch it ended on, after an end check that failed), or with a work branch that has commits `main` lacks: a **RESUME** run;
   - anything else (uncommitted changes on `main` that no heartbeat left, another branch, a detached HEAD, a merge nobody's run started): **skipped with an alert at once**, and nothing is touched. Your own uncommitted work is never resumed.
4. **Doctor.** `jerome doctor` runs: setup, lean profile, hooks and permission rules. Its `/context` check uses no tokens. Only a check without which the run cannot work stops it: the project, its database, the permission rules, the hooks. The others, such as the size of the startup context, the profile or the scheduled job, are written to the log as warnings and the run goes on (D158).
5. **Limits.** If a subscription window is at or over its limit (the project's `quota`, else the global one), or the project's spend today or this week is at or over its limit, it skips, at zero tokens, until the window resets; you get one notification per pause (see [limits.md](limits.md)). `jerome heartbeat override --today` lifts all of it for this project until midnight. A reading older than 3 hours is mentioned in the reason; one whose window has reset since is ignored.
6. **RESUME runs** go straight to the lead agent, with no triage: its task is to finish the half-done work (commit, verify, merge) or drop it (discard, delete the branch, note why in `open.md`), and nothing else.
7. **Areas.** The [areas](areas.md) that are paused, waiting for a milestone request of their own, or whose pace has not come round since their last heartbeat are left out, at zero tokens. If none is left, it stops here with the reason. A project without `areas.md` has one area, always due. The pages an area follows are fetched and saved for its agents, and an area with `Trigger: watch` is left out when none of them changed (see [areas.md](areas.md#pages-an-area-follows)).
8. **Nothing changed.** If neither the commits, `open.md`, `decisions.md`, `scope.md`, `areas.md`, the areas due, the slot nor the answered decision requests changed since a heartbeat found no work, it stops here at zero tokens.
9. **Triage.** A call on Haiku, with no tools and outside the project, reads the areas due, highest priority first, with their goal, milestone and criteria, the slot's text, then `open.md`, the latest commits, the decision requests and the latest digest lines. It answers whether there is one task the lead agent can do now without you, and in which area. A task that depends on an open request or question is not one, nor an item marked for an interactive session or under a parked or ideas section; an area with an open request still has the others; the assumptions of `open.md` hold nothing up; an answered request that changes an area's milestone comes first; when an area's criteria look all met, the task is to check them. An area with no goal or criteria, as in a project brought in without a brief, is no reason for no work: the triage takes an open item of `open.md` (D176). A slot's text that names work makes that work the task. An area that was not due is never taken. Its whole verdict is kept with the run. About 5,000 tokens.
10. **Lead agent.** Only then: a new session, never a resumed one, on Opus by default, with the task, its area, the slot's text, the requests still open, the turn cap and the project's permission rules. Its prompt, shipped with Jérôme and the same for every project, says: first, ask the open questions of `open.md` not yet asked, each as a decision request (D181), also when resuming, and record as decisions the answers the user gave to those already asked, which the prompt lists with the user's words, removing their questions (D192); then one task, on a new `agent/<name>` branch; delegate to the project's agents in the foreground and wait for every result; never ask, push, deploy, publish or send mail; verify with the project's `test` command and what `PROJECT.md` asks for (such as screenshots of visual changes); merge into `main` when that passes with no conflicts, one repository-changing command per call, staging named paths; otherwise a decision request; append its line to `.jerome/digest.md`, update `open.md`, and end on `main` with a clean tree.
11. **End check**, after every run of the lead agent: back on `main`, tracked tree clean, no merge or rebase in progress, a line added to `.jerome/digest.md`, and Claude Code exited with 0 within the max duration. Anything else fails the run, raises an [alert](#alerts) at once, and the next run starts in RESUME mode. A run refused a tool ends `blocked` whatever its end check says: see [permissions](#permissions).

### Permissions

A heartbeat runs with `--permission-mode acceptEdits`: file edits are allowed, and any other tool call that the project's allow rules (`.claude/settings.json`) do not cover would need someone to approve it. Nobody is there, so it is refused. Each run is therefore also given, with `--allowedTools` (D129, D159):

- **any command** (`Bash`), so the lead agent and its agents use what is on the machine (python3, node, npm, the project's scripts) without asking. Still refused:
  - pushing, merging or releasing on GitHub, publishing, deploying, sending mail: the `deny` rules of `.claude/settings.json` (D46), which Claude Code applies whatever is allowed;
  - `sudo`, `su`, `doas`;
  - deleting outside the project's folder and the temporary folders, or a path that depends on a variable;
  - credentials: the Keychain (`security`), `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.netrc`, `~/.npmrc`, `~/.config/gh`, `~/.kube`, an `.env` file outside the project;
  - a download piped into a shell (`curl … | sh`).

  The last four are checked by Jérôme's `PreToolUse` hook in heartbeats only (`src/blacklist.js`); it tells the agent why, and the agent goes another way. In your own sessions you decide, as before;
- the `test` command, as `Bash(npm test)` and `Bash(npm test:*)`, since its prompt tells it to run it;
- the rules in `heartbeat.allow`, for every run;
- the rules in the slot's `allow`, for that slot's runs only, such as the script its text names.

Since any command, reading any file but credentials, `Monitor`, `WebSearch` and `WebFetch` are allowed (D159, D170, D171), `heartbeat.allow` and a slot's `allow` matter for the other tools, above all MCP servers, which may write or send and so run only where the project allows them: `mcp__memento` for every tool of the server `memento`, `mcp__memento__search` for one. The rules are Claude Code's: `Bash(./tools/import.sh:*)` for a command and any arguments, `Bash(npm run e2e)` for that exact command. `jerome heartbeat install` prints them for each slot.

A tool call refused anyway, by the lead agent or one of its subagents, ends the run as `blocked: permission denied for Bash(npm run e2e): add the rules to heartbeat.allow in .jerome/project.json`, with an alert at once, even when its end check passed: a run that could not run what it needed did not do its task. A call refused by a `deny` rule of the project's, or by Jérôme's own hooks (such as `git add -A`), is a refusal on purpose and does not count.

### Bounds on the lead agent

- **Subagents are waited for.** Headless `claude -p` kills background tasks 10 minutes after the lead agent's last turn; the runner starts it with `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`, which removes that ceiling, and its prompt asks for foreground delegation anyway.
- **Max duration.** Claude Code runs in its own process group; at `maxMinutes` the whole group is stopped (`SIGTERM`, then `SIGKILL` 10 seconds later), test servers and other leftovers included, and the run ends `stopped: max duration`. Whatever Claude Code leaves running when it exits normally is stopped too.
- **Token and turn caps.** The token cap counts the whole run, the lead agent and its subagents: the runner follows the usage the lead agent streams and, every few seconds, the session's transcripts, its own and its subagents'. Each call counts what it reads and writes whole, and the context it reads again from the cache, the same at every turn, at a tenth, as it is billed (D185): counted whole, that context alone stopped runs after a dozen turns. The live view shows the run's tokens counted the same way. Over the cap, the run is stopped, subagents included, and the reason says who used what: `token cap: 512,300 tokens over 500,000 (main 204k, researcher 308k)`. The turn cap, the maximum duration (`maxMinutes`, 90 by default) and, with the governor on, the 5-hour cap and the reserve still bound a run whatever its tokens. A task stopped by either cap is not tried again by itself (D182): the runner opens a decision request at once, at no token cost, saying in plain words which work stopped and offering to split it into smaller steps, try it again or drop it. While that request is open, the triage chooses other work and the run that resumes the half-done branch leaves it alone. Caps given for one run only (`--max-tokens`) are a trial and ask nothing.
- **Stopping a run by hand.** Ctrl+C on a run started by hand stops its lead agent the same way and records the run as `stopped: interrupted`.

A run whose end check failed may leave the tree on its branch. With a clean tree, the runner goes back to `main` and says so in the reason: a branch without commits of its own is removed, one with commits is kept for the next run, which resumes it (`branch agent/x left, 2 commits: kept, back on main; next run resumes`). With uncommitted changes it touches nothing; the next run resumes from there.

A heartbeat cannot create agents or change `.claude/settings.json`: Claude Code protects the `.claude/` folder, and nobody is there to approve a write. Team and permission changes happen in your sessions.

Long sessions are where the lead agent's usage grows: on one project it made about 90% of the tokens over a week. A heartbeat therefore always starts a new session, and keeps the lead agent's own work to deciding and delegating.

Its usage is recorded by the [hooks](hooks.md), and the subscription windows it receives update `account.json`.

## Alerts

An alert is something wrong with the autonomous runs themselves, as opposed to a decision. It is raised:

- **at once** for a run lost (its runner died, or it ran far past its max duration: see [lost runs](#lost-runs)), a heartbeat that should have started and did not (see [missed starts](#missed-starts)), a failed end check (except after a run stopped by its cap), a run stopped at its max duration, a tool refused (see [permissions](#permissions)), a start state that no heartbeat left (your changes on `main`, another branch, a detached HEAD, a merge in progress), or a slot job whose slot is gone;
- **on the second time in a row** for any other skip or failure with the same reason, such as a failed triage. A run that finds the lock taken, a pause for a limit or the governor's are never an alert: they end by themselves (D160). An untrusted folder or a provisional `PROJECT.md` is an alert at once, no longer a decision request: a request is for a choice only you can make.
- **on the third time in a row** for a run stopped by its token or turn cap: a normal end, which the next run resumes (D158).

Alerts live in the project database, like decision requests, and never in a tracked file. They show:

- first in `jerome state`, on an `ALERTS` line under the title;
- at the start of your next session: `SessionStart` gives them to the lead agent, which tells you about them before anything else, and shows you a line of its own;
- in `jerome projects`, as the first reason a project needs you;
- in `jerome heartbeat status`, with the detail;
- in the status line of every session of the project, as `⚠ 1 alert` (D137);
- **only when it lasts** (D160, D161), on [Telegram](telegram.md) when the bridge is set up, as a macOS notification and through the push channel: when it has cost three runs in a row, or has been open six hours, and then once a day while it stays open. The watchdog checks every minute, so a block with no run after it is told too. The message is one sentence written for a person, with the one thing to do and how long it has lasted, never the runner's reason, a path or a token count: `There are changes of yours not committed (README.md). Commit or discard them, and it starts by itself. Stuck for 7 h, 3 runs lost.` A pause for a limit is never notified. If the notification cannot be shown, the log says why.

An open alert counts its repeats rather than opening another, and everywhere it is shown says what it has cost: `A3 uncommitted changes (src/app.js) on main, … (5 runs lost since 2026-10-27 18:00)`. A macOS notification reaches you only at that Mac: on a machine you do not sit at, set a push channel. All of a project's alerts close by themselves when a heartbeat ends well.

**Push channel.** Off by default. `heartbeat.alerts.command` in `.jerome/project.json` is a shell command run in the project's folder, with the alert on standard input and in `JEROME_ALERT_PROJECT` and `JEROME_ALERT_MESSAGE`; its output is never logged. That file is versioned, so the command must hold no secret: have it read one from your machine, as in `curl -fsS -d @- "$(cat ~/.config/jerome/ntfy-url)"`, or from the keychain.

## Lost runs

A run whose process is gone stays `running` in the database unless something closes it. Each heartbeat records its runner's process and its lead agent's, and each interactive session its Claude Code process (D136). A heartbeat still marked running is closed as `failed`, `lost: the runner died`, when its runner is gone, and as `lost: still running … over its max duration` 15 minutes after its `maxMinutes`, its runner stopped. Its lead agent, in a process group of its own, is stopped with its whole group if it outlived the runner. Either is an alert at once, and the next run resumes what it left in the tree. They are closed by the next heartbeat of the project (which holds the lock, so any other running heartbeat is dead), at the start of a session, and every minute by the [watchdog](commands/watchdog.md).

## Missed starts

A job that should have started a heartbeat and did not leaves no run at all: launchd did not load it, `node` was not found, or the Mac was off. The [watchdog](commands/watchdog.md), one job per machine running every minute, checks each installed job: the last time its schedule fired, 10 minutes back, and whether a heartbeat of that slot started since (a skipped run counts as started). A missed one is an alert, told to you when it lasts like the others, saying why when it can: `the heartbeat of slot evening due at 2026-10-28 18:00 did not start: the Mac was off then`. `jerome projects` shows it too (D135).

A Mac that is off cannot report itself: an outside check (a ping the watchdog would send to a service that tells you when the pings stop) is parked (P4).

## Marathon

```sh
jerome heartbeat marathon --until 23:30
jerome heartbeat marathon --until 24:00    # until midnight
```

Runs heartbeats back to back until the given time **of the calendar day it started**, compared as a full date and time, never as an hour alone: a marathon started at 21:00 with `--until 24:00` stops at midnight and never runs into the next day, and one started after its time does not run at all. After a run where the lead agent worked it pauses 2 minutes; after a skip, a failure or no work, 30 minutes. While another heartbeat holds the lock, a scheduled one for instance, it waits for it instead of starting one. Every run goes through all the steps above, guarantees included. It holds the terminal: run it in a terminal of its own, or with `nohup … &`.

## Working alongside a heartbeat

A session you are working in has the project to itself (D187), and you never have to stop anything by hand:

- **While you use a session, no heartbeat starts in the project.** In use means its transcript, or its usage, moved in the last 20 minutes; a session left open and forgotten holds nothing, which is why merely open sessions stopped holding heartbeats back (D73, D122). A fill run goes to another project instead, and a heartbeat started by its pace stops at once as "session in use", quietly, with no alert. A slot's run, which has its time, waits for the session to rest, at most an hour, holding no lock, then starts anyway; its start is recorded as when it really began.
- **A heartbeat already running keeps its working tree.** While it holds the project's lock, the `PreToolUse` hook refuses, in your sessions in the same working tree, the git commands that change the repository (`commit`, `switch`, `merge`, `stash`, `add`…); reading and editing files stay allowed, and `git worktree add` is let through. The session is told so when it opens and when a command is refused: for a change that cannot wait it works in a worktree of its own, commits there, runs `jerome heartbeat wait` in the background, and merges into `main` as soon as the run ends, then removes the worktree. It tells you in one line that the fix goes in once the run ends, and never asks you to stop the run.
- **When you leave, nothing is left hanging.** The session commits its work and ends on `main` with a clean tree before you go. What it leaves anyway is taken care of as before: Jérôme's own state files are committed by the next heartbeat, and other uncommitted changes stop the heartbeats with a block you can clear from Telegram.

## Decision requests

A heartbeat never asks: nobody reads it. For an important decision (irreversible, costly, outward-facing, changing the goal or scope, or against a recorded decision) the lead agent runs `jerome request open --question … --options … --recommendation …` and goes on with the parts of its task that do not depend on it; a minor, reversible choice it makes itself, as an assumption in `open.md` (see [lead-agent.md](lead-agent.md#questions-and-assumptions)). The heartbeat's own checks open requests the same way. You get a macOS notification when a request is opened or a heartbeat fails.

When you next open a session in the project, the lead agent is told about the open requests and brings them up. Once you answer, it records the answer with `jerome request answer <id> "<answer>"` (and in `decisions.md` if it is a decision), or drops it with `jerome request drop <id>`. The next heartbeat sees the answer and starts again. A request opened in a heartbeat belongs to its area (`jerome request open --area <name>` sets one by hand). A question holds up only the work that depends on it: its area stays due, the triage picks a task that does not depend on it, and the lead agent is told it is already asked. A milestone request, opened with `--milestone` when an area's criteria are met, holds up its whole area until you answer, and the others go on. `jerome state` and `jerome view` list the open requests.

## Digest

At the end of each heartbeat the lead agent appends one line to `.jerome/digest.md`, with the area it worked on:

```
- 2026-10-15 14:24 · development · checked the rupture report for the rigid hook fields · hook-rigid-fields-rupture · R2
```

`jerome digest [--since 7d]` puts those lines together with the figures of the period, at zero tokens: runs by kind and status, usage and its API equivalent, decision requests, and commits on `main`.

## Tried on a real project

- With uncommitted changes, the heartbeat stopped in 0.2 seconds and opened a request (since D119 it raises an alert instead).
- With a clean tree, the triage chose a task; the lead agent found it depended on an open question, wrote its findings on a branch, opened a decision request instead of deciding, merged the branch, added its digest line and ended on `main`: 164,000 tokens in one minute.
- A second heartbeat started at the same time stopped on the lock; the next one found no work because of the open request; the one after stopped at zero tokens, since nothing had changed.
- With a test threshold of 15% and the 7-day window at 21%, it skipped. An untrusted copy of the project opened its request.
- Started by launchd, with the paths of an nvm install, it ran the triage. With the job's `node` path broken, `jerome doctor` reported it with the command to schedule again.

Slots, RESUME mode, the end check, the max duration, alerts, the marathon and the guard for sessions working alongside (D118-D125) are covered by tests on throwaway repositories with a fake `claude` and `launchctl` (`test/autonomy.test.js`), not yet tried on a real project.

Replacing scripts of your own with these guarantees: see [migrating-heartbeat-scripts.md](migrating-heartbeat-scripts.md).
