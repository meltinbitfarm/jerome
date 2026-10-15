# Heartbeats

A heartbeat is a scheduled run of the lead agent: it does one task without you, on a branch, and leaves a decision request when it needs you. Nothing runs by default. You schedule heartbeats per project, with a cap per run.

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

The schedule and the caps are saved in the project's `.jerome/project.json`. Raise the caps for a project that needs more.

## How it is started

Heartbeats run on macOS through launchd: `jerome schedule` writes a job to `~/Library/LaunchAgents/` and loads it. launchd loads no shell profile, so a `node` installed with nvm would not be found: the job holds the absolute paths of `node`, `jerome` and `claude` found when you scheduled it, and a `PATH` built from their folders. These paths stay in the job, on your machine; `.jerome` only holds the schedule. If you switch Node version or move Claude Code, `jerome doctor` reports the broken path with the command to schedule again. A heartbeat missed while the Mac slept runs once when it wakes. Each run writes one line to `~/.cache/jerome/logs/<project>.log`.

## What a heartbeat does

`jerome heartbeat` goes through these steps, and stops at the first one that says no. Every heartbeat leaves one run in the [database](database.md), with its status and reason, visible in `jerome state` and `jerome view`.

1. **Lock.** One heartbeat per project at a time: a second one stops with "locked". A lock left by a crashed heartbeat is taken over.
2. **Interactive session.** If you have a session open in the project, it skips.
3. **Checks**, each opening a decision request when you have to act, once until you answer it:
   - the folder is trusted in Claude Code, which otherwise ignores the project's allow rules;
   - `PROJECT.md` is not provisional;
   - the working tree has no uncommitted changes (`.jerome/digest.md` and `.jerome/project.json` excepted);
   - `jerome doctor` passes: setup, lean profile, hooks and permission rules. Its `/context` check uses no tokens.
4. **Limits.** If a subscription window is at or over its global limit, or the project's spend today or this week is at or over its limit, it skips, at zero tokens, until the window resets; you get one notification per pause (see [limits.md](limits.md)). A reading older than 3 hours is mentioned in the reason; one whose window has reset since is ignored.
5. **Nothing changed.** If neither the commits, `open.md`, `decisions.md`, `scope.md` nor the answered decision requests changed since a heartbeat found no work, it stops here at zero tokens.
6. **Triage.** A call on Haiku, with no tools and outside the project, reads `open.md`, the success criteria, the latest commits, the decision requests and the latest digest lines, and answers whether there is one task the lead agent can do now without you. A task that depends on an open request or question is not one. About 5,000 tokens.
7. **Lead agent.** Only then: a new session, never a resumed one, on Opus by default, with the task, the turn cap and the project's permission rules. It works on a branch, delegates the heavy work to the project's agents, merges into `main` when the tests pass with no conflicts, opens a decision request instead when they fail or there is a conflict, appends one line to `.jerome/digest.md`, and ends on `main` with a clean tree. The token cap is enforced from the usage it streams: over the cap, the run is stopped.

Long sessions are where the lead agent's usage grows: on one project it made about 90% of the tokens over a week. A heartbeat therefore always starts a new session, and keeps the lead agent's own work to deciding and delegating.

Its usage is recorded by the [hooks](hooks.md), and the subscription windows it receives update `account.json`.

## Decision requests

A heartbeat never asks: nobody reads it. The lead agent runs `jerome request open --question … --options … --recommendation …` and stops that line of work. The heartbeat's own checks open requests the same way. You get a macOS notification when a request is opened or a heartbeat fails.

When you next open a session in the project, the lead agent is told about the open requests and brings them up. Once you answer, it records the answer with `jerome request answer <id> "<answer>"` (and in `decisions.md` if it is a decision), or drops it with `jerome request drop <id>`. The next heartbeat sees the answer and starts again. `jerome state` and `jerome view` list the open requests.

## Digest

At the end of each heartbeat the lead agent appends one line to `.jerome/digest.md`:

```
- 2026-10-15 14:24 · checked the rupture report for the rigid hook fields · hook-rigid-fields-rupture · R2
```

`jerome digest [--since 7d]` puts those lines together with the figures of the period, at zero tokens: runs by kind and status, usage and its API equivalent, decision requests, and commits on `main`.

## Tried on a real project

- With uncommitted changes, the heartbeat stopped in 0.2 seconds and opened a request.
- With a clean tree, the triage chose a task; the lead agent found it depended on an open question, wrote its findings on a branch, opened a decision request instead of deciding, merged the branch, added its digest line and ended on `main`: 164,000 tokens in one minute.
- A second heartbeat started at the same time stopped on the lock; the next one found no work because of the open request; the one after stopped at zero tokens, since nothing had changed.
- With a test threshold of 15% and the 7-day window at 21%, it skipped. An untrusted copy of the project opened its request.
- Started by launchd, with the paths of an nvm install, it ran the triage. With the job's `node` path broken, `jerome doctor` reported it with the command to schedule again.
