# Lessons on agents' token use

These lessons come from measuring Climb Daily on 14/10/2026, when its agents still ran on Paperclip, before Jérôme existed. They were kept in Memento Vault (collection `agent-orchestrator`) and are copied here, in English, because Jérôme no longer depends on the vault. Each rule says whether Jérôme applies it today, and where.

## What was measured

- **44 million tokens in 21 runs.** Each run paid a fixed cost of 1 to 1.5 million tokens before doing anything useful, and a run with no bound reached 3 to 5 million.
- **Where they went:**
  - work relayed from agent to agent (PM to QA to developer), each one reloading the context;
  - a roadmap of about 80k characters loaded at every run;
  - large files read whole;
  - agents debugging their environment (browsers, servers, logins) instead of the task;
  - runs woken up by themselves on issues nobody was working on anymore.

## The rules

| # | Rule | In Jérôme | Where |
|---|---|---|---|
| 1 | A turn cap per role: lead 30, QA 40, verification 50, research and writing 60, developer 80 | **Partly.** One turn cap per run (40 by default), with a token cap that counts the lead agent and its subagents together. No cap per role. | `--max-turns`, `maxTurns` in [heartbeat.md](heartbeat.md#bounds-on-the-lead-agent), [configuration.md](configuration.md) |
| 2 | No work, zero tokens | **Yes.** Lock, limits, areas not due and "nothing changed" stop a heartbeat before any model runs; the triage on Haiku costs about 5,000 tokens. | steps 1–9 of [heartbeat.md](heartbeat.md#what-a-heartbeat-does) |
| 3 | One run at a time per agent | **Yes, per project.** One heartbeat per project at a time, and one task per run. | the lock, [heartbeat.md](heartbeat.md#what-a-heartbeat-does) step 1 |
| 4 | A lean "current state" of about 3,000 characters; the log is written but not read again, at most its last 10 lines | **Yes, without a size limit.** `open.md` holds only what is open, closed items go to `archive.md`; the triage reads the last 3 lines of `digest.md`. Nothing caps the size of `open.md`. | [memory-format.md](memory-format.md), D200 |
| 5 | Large files read in parts | **No.** The lead agent's instructions and the agent catalog do not say it. Some projects say it in their own instructions (the Radar's registers). | — |
| 6 | Tests at most twice per run, with filtered output | **No.** The developer runs the tests that cover its change, with no count and no filter. | `template/.claude/skills/project-team/agents/developer.md` |
| 7 | No screenshots or browser diagnosis by agents: the supervisor does them | **No, on purpose.** `PROJECT.md` may ask for screenshots of visual changes; recipes keep how to take them, so a run does not work it out again (D199). | [heartbeat.md](heartbeat.md#what-a-heartbeat-does) step 10, recipes |
| 8 | Environment problems: two attempts, then stop | **Partly.** Recipes keep what was worked out (D199); at 80% of the token cap every agent is told to wrap up; a task stopped twice by its caps becomes a decision request (D182). Nothing counts attempts. | [heartbeat.md](heartbeat.md#bounds-on-the-lead-agent) |
| 9 | One issue per problem; the developer hands over to QA directly, without relays | **Yes, in another form.** There is no issue tracker and no relay: the lead agent delegates each task to one agent, which reports in at most 150 words and writes the details to `.jerome/notes/`. The lead agent passes file paths, not contents. | `template/.claude/rules/jerome.md`, Delegating |
| 10 | Verification on a 20% sample, everything when 2 or more errors are found | **No.** | — |
| 11 | Opus only for code and quality writing; Sonnet for coordination and research | **Mostly.** The catalog has developer and writer on Opus, analyst and researcher on Sonnet, clerk and documentarist on Haiku, and the triage on Haiku. The lead agent, which coordinates, is on Opus by default. With the governor on, a run moves to Sonnet when Opus's own weekly limit is ahead of its pace. | `template/.claude/skills/project-team/agents/`, [quota-governor.md](quota-governor.md#the-pace) |
| 12 | Close dead issues | **Yes.** Closed work goes to `archive.md`; runs whose process died are closed by the watchdog; work stopped twice is not tried again by itself (D182). | [memory-format.md](memory-format.md), [heartbeat.md](heartbeat.md) |
| 13 | An emergency brake | **Partly.** Limits pause heartbeats; an area can be `paused`; `jerome governor off` stops fill runs; Ctrl+C stops a run started by hand. No single command stops every heartbeat of every project. | [limits.md](limits.md), [areas.md](areas.md) |
| 14 | An alarm above 1 million context tokens per run | **Yes, stronger.** The token cap (500,000 by default) stops the run, subagents included, and says who used what. | [heartbeat.md](heartbeat.md#bounds-on-the-lead-agent) |
| 15 | Measure tokens and quota %, not money | **Partly, on purpose.** Global limits and the governor use the subscription's real %; project limits are in API-equivalent dollars with tokens beside them, because 94% of a project's tokens were cache reads that cost a tenth. | [limits.md](limits.md) |

## Not applied

Rules 5, 6 and 10 are not applied, and rules 1, 8 and 13 only in part:

- **1:** turn caps per role.
- **5:** read large files in parts.
- **6:** run the tests at most twice per run, with filtered output.
- **8:** count the attempts at an environment problem and stop after two.
- **10:** check a 20% sample, everything when 2 or more errors are found.
- **13:** one brake that stops every heartbeat.

Rule 7 is set aside on purpose, as are the dollars of rule 15. Any of them would be a decision of Fabio's before it is built.
