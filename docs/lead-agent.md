# The lead agent

Every Jérôme project has one lead agent: the main Claude Code session you talk to. Its instructions live in `.claude/rules/jerome.md`, which comes from the template and which Claude Code loads at startup like a `CLAUDE.md`. The project's own `CLAUDE.md`, if it has one, stays the project's and is loaded too. The state files named on this page are in `.jerome/` (see [project-layout.md](project-layout.md)).

## What it does

- **Speaks your language**, briefly, with at most one question per reply.
- **Keeps the project state.** It is the only one that edits `PROJECT.md`, `decisions.md` and `open.md`. Subagents report to it, and it records what matters.
- **Respects decisions.** It cites entries by ID ("see D4") and does not reopen a recorded decision unless a concrete problem appears.
- **Records only what you confirmed.** A decision it proposed is not recorded until you explicitly confirm it: silence is not confirmation. Before recording, it lists its unconfirmed proposals and assumptions so you can confirm them in one block.
- **Asks only what matters.** For an important decision it ends with a decision request: the question, the options and its recommendation. Minor choices it makes itself, as assumptions you confirm later, and a question never stops the work that does not depend on it (see [below](#questions-and-assumptions)).
- **Delegates cheaply.** It uses subagents, never agent teams. It passes file paths instead of contents, asks for a short summary with the details written to a file, and picks the cheapest model that fits the task.
- **Stays within limits.** It follows the agent limits in `PROJECT.md`. By default it only prepares drafts and proposals: it never sends, publishes, deploys, pushes, buys or emails.
- **Works on branches.** Every task runs on its own branch. When the tests pass and there are no conflicts, the lead agent merges it into `main` by itself and says so in its reply; it asks you only when tests fail or there is a conflict. Subagents never merge, and nobody pushes: that stays with you. Commands that change the repository run one at a time, each result checked before the next, so a blocked command never leaves it unclear what already ran.

## Questions and assumptions

The lead agent asks you only for important decisions (D116):

- irreversible, such as deleting data or a migration with no way back;
- costly: money, a paid service, or a large share of the subscription;
- outward-facing: anything that publishes, sends or commits the project to someone else;
- changing the goal or the scope;
- against a recorded decision.

Every other choice is minor and reversible: it picks a sensible default and notes it in `open.md`, under `## Assumptions`, one line each, `A3: choice — reason`. Assumptions are not decisions, and are not written to `decisions.md` until you confirm them. At the start of each session, the [`SessionStart` hook](hooks.md#open-decision-requests-at-session-start) gives the lead agent the open assumptions, and it puts them to you in one block, after any decision requests. A confirmed one becomes a D-entry; a corrected one becomes the correction's D-entry, and the work is changed to match; both leave `open.md`. `jerome state`, the [viewer](commands/view.md) and [`jerome projects`](commands/projects.md) count them, and they never hold anything up.

A question does not stop the work either (D117). In a session the lead agent goes on with everything that does not depend on the answer and ends with the decision request. In a [heartbeat](heartbeat.md#decision-requests) it opens the request and goes on with the rest of its task; later heartbeats keep giving the area work that does not depend on it, and are told it is already asked. Only a milestone request, opened when an area's criteria are met, holds up its whole area.

## What it reads, and when

`jerome.md` is loaded into every session and every scheduled run, so it is kept as small as possible.

| File | When it is read |
|---|---|
| `.claude/rules/jerome.md` | Always, at startup |
| `PROJECT.md` | Always, at startup, imported by `jerome.md` with `@../../.jerome/PROJECT.md`: goal, constraints, agent limits and project rules |
| `areas.md` | Before choosing work, proposing an approach, a plan or agents, or calling work or a milestone done: the [areas](areas.md), each with its goal, milestone and criteria, folder, agents, pace and priority |
| `scope.md` | Before proposing an approach, a plan or agents; before calling work done; when a request may be out of scope: context, out of scope, success criteria, tools, pace, and each area's context |
| `decisions.md` | Before proposing an approach, a plan or agents, or when a decision is cited |
| `open.md` | For status questions, or when an open or parked topic comes up |
| `archive.md` | Only when a cited ID is not in the other files |

`PROJECT.md` holds only what the lead agent needs at every turn, because it is paid at every call, heartbeats included. A carefully interviewed brief is long, and that is normal: nothing in it is dropped, the rest goes to `scope.md` and is paid only in the turns that read it. On a real brief (an app for climbing competitions), the old single `PROJECT.md` was 1,600 tokens, 592 of them for the success criteria alone; split, `PROJECT.md` is 617 tokens and `scope.md` about 1,000.

To keep the files that are read on demand light, the lead agent moves closed entries from `open.md` and long-superseded decisions to `archive.md`. Their IDs stay the same.

## Project rules

`jerome.md` comes from the template, and template files are replaced when the project is updated to a newer Jérôme version with [`jerome update`](commands/update.md). Rules that belong to one project only, such as conventions, tools to prefer or things to avoid, go in `PROJECT.md` under a `## Project rules` section, one line per rule:

```markdown
## Project rules
- Use pnpm, never npm.
- Tests run with `pnpm test` before every commit proposal.
```

The lead agent adds the section when the first rule comes up, and `jerome.md` tells it never to write rules into itself. `PROJECT.md` is a state file that updates never touch, and it is already loaded at startup, so the rules cost nothing extra beyond their own lines. They count towards `PROJECT.md`'s budget.

## Projects from before `scope.md`

Projects created before `scope.md` existed have all the brief's sections in `PROJECT.md`. `jerome doctor` warns about it and names the sections to move. To migrate:

1. run `jerome update`, so the lead agent's instructions know about `scope.md`;
2. ask the lead agent: "move Context, Out of scope, Success, Tools, Pace and usage from PROJECT.md to scope.md, unchanged".

## A project started from free text

When `jerome new --from-file` gets a text that is not a valid brief, it saves the text in `brief.md` and writes a provisional `PROJECT.md` whose only content is an instruction for the lead agent (see [new.md](commands/new.md#importing-a-brief)). Since `PROJECT.md` is loaded at startup, the lead agent sees it in the first session and, before any other task. If your first message asks for something else, it acknowledges it in one line ("I'll get to it right after") and starts the conversion, without answering it or doing anything for it first:

1. converts `brief.md` with the `project-brief` skill;
2. lists the decisions it found and asks you to confirm them in one block, because the text may come from another chat and hold proposals you never confirmed;
3. writes `PROJECT.md`, `scope.md`, `areas.md`, `decisions.md` and `open.md`, replacing the provisional file, and leaves `brief.md` as the original text.

The instruction lives in `PROJECT.md` and not in `jerome.md`, so it costs tokens only until the conversion. Until then, `jerome doctor` warns that the project is provisional, and [heartbeats](heartbeat.md) do not start on it.

## Personality

The lead agent is **Jérôme**, and says so: warm, friendly, lightly ironic, like a trusted colleague, in your language (D126). The irony is never at your expense, and it goes when something broke or you are under pressure: then Jérôme is plain and clear. The personality is for talking only: `decisions.md`, `open.md`, decision requests, the digest and commit messages stay plain, since you read them again later. Subagents do not load `jerome.md`, so they keep their short, technical replies. A project that wants another tone, such as a formal one for a client, says so in `PROJECT.md` under `## Project rules`.

## What goes in `jerome.md`

`jerome.md` is paid at every call, so a rule goes there only if the lead agent needs it at every turn. Rules needed at specific moments go in a skill, whose description costs a few tokens and whose body is read only when it applies: the briefing in `project-brief`, the team in `project-team`.

A rule a hook can enforce costs nothing there: staging named paths rather than `git commit -a` or `git add -A`, and leaving git to a running heartbeat, are refused by the `PreToolUse` hook with a reason that says what to do (see [hooks.md](hooks.md#staging-named-paths)), so `jerome.md` only adds the rules no hook can see: unattended work runs only through `jerome heartbeat`, never through scripts or loops of the lead agent's own (D125); the user is never asked to stop a running heartbeat, and before they leave the work is committed and the tree is back on `main`, clean (D187). How to work beside a running heartbeat, in a worktree merged once `jerome heartbeat wait` returns, is told by the session's start and by the hook's refusal, when it is needed, not at every turn (D189). The invariants of a heartbeat itself (one task, foreground delegation, end on `main` with a clean tree) are in the heartbeat's prompt, paid only by heartbeats.

## Token budget

| File | Budget | Current |
|---|---:|---:|
| `jerome.md` | 850 tokens | 841, measured with `/context` |
| `PROJECT.md` | 800 tokens | depends on the brief: 244 and 617 in two real projects |

`jerome doctor` warns when a file goes over its budget. It never blocks anything: budgets make the cost visible, they do not limit what a project can be. When a project really needs more context loaded at every turn, raise its budgets in `.jerome/project.json`:

```json
{
  "schema": "jerome.project/v1",
  "budgets": { "PROJECT.md": 1200 }
}
```

Only `jerome.md` and `PROJECT.md` have budgets. A project's own `CLAUDE.md` has none, since it is not Jérôme's to trim, but `jerome doctor` shows its weight next to `jerome.md`. Invalid entries are reported by `jerome doctor` and the defaults apply. `jerome update` keeps the field.

Measured in phase 2 on a project created with `jerome new`, with a 614-token `PROJECT.md` and the lead agent's instructions, then in a root `CLAUDE.md`, at 496 tokens. Moving them to `.claude/rules/jerome.md` later cost the same (D87):

| | Without the instructions | With the instructions and `PROJECT.md` |
|---|---:|---:|
| Estimated startup context (`/context`) | 10.4k | 11.5k |
| Input tokens of one real call | 12,348 | 13,735 |

So the lead agent's instructions and the project summary add about 1.4k tokens to every call.

## Subagents

Claude Code also loads `CLAUDE.md` and rules files such as `jerome.md`, with what they import, into subagents. In the same test project a trivial subagent call cost 2,518 input tokens with it and 1,142 without. For this reason:

- the agents of Jérôme's catalog set `omitClaudeMd: true`, which keeps out `CLAUDE.md` and `.claude/rules/` alike (measured: 2,209 tokens with the instructions in rules, 2,189 with them in `.claude/CLAUDE.md`); the project's limits are copied into each agent's own file instead (see [agents.md](agents.md));
- built-in subagents still load it, and its opening line tells them to ignore it.

`jerome.md` only says to delegate to the agents in `.claude/agents/` and to create or change them with the `project-team` skill after you confirm. How to pick the team and models lives in the skill, read only when needed.

## Service calls

Some runs are not the lead agent's work, for example the documentation agent behind [`jerome docs`](commands/docs.md). When the CLI launches `claude -p` for them, it:

- starts from a service folder outside the project, so the lead agent's instructions are not loaded;
- passes `--settings` with the project's `.claude/settings.local.json`, so the lean profile still applies. Without it, a folder outside the project gets every plugin, skill and connector you have installed: 14.1k tokens instead of 10.4k on the test machine;
- passes `--no-session-persistence`, so the run leaves no transcript that would be counted as project usage;
- adds the project with `--add-dir` only when the task needs its files. The lead agent's instructions still stay out, while the project's skills come in.

The service folder is one fixed path per project, emptied before each call, because Claude Code keeps a small folder in `~/.claude/projects/` for every folder it is started from.

## Open questions are asked

The open questions of `open.md`, from the brief or written in a session, are for you, and nobody asks them by sitting in a file. A heartbeat asks the oldest one not yet asked as a decision request, with options and a recommendation, so it reaches you on Telegram with its buttons, and marks it `(asked: R<n>)`; once you answer, the answer becomes a decision and the question goes. Every one not yet asked, each as its own request, in the next heartbeat (D178, D180).

Parked ideas are not forgotten either: one that says when to come back to it ("after 16/12") is asked the same way once that time comes, with three options: take it up now, park it until a new date, or drop it. One with no date is asked when its area's milestone changes (D179).

No work waits for an interactive session: you do not have to open one. A heartbeat does the work, and asks you, as a decision request, for what only you can do, saying exactly what is needed; an item once marked for a session is taken up the same way (D180).
