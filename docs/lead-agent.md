# The lead agent

Every Jérôme project has one lead agent: the main Claude Code session you talk to. Its instructions live in the project's `CLAUDE.md`, which comes from the template.

## What it does

- **Speaks your language**, briefly, with at most one question per reply.
- **Keeps the project state.** It is the only one that edits `PROJECT.md`, `decisions.md` and `open.md`. Subagents report to it, and it records what matters.
- **Respects decisions.** It cites entries by ID ("see D4") and does not reopen a recorded decision unless a concrete problem appears.
- **Records only what you confirmed.** A decision it proposed is not recorded until you explicitly confirm it: silence is not confirmation. Before recording, it lists its unconfirmed proposals so you can confirm them in one block.
- **Asks when it must.** When you need to decide, it ends with a decision request: the question, the options and its recommendation.
- **Delegates cheaply.** It uses subagents, never agent teams. It passes file paths instead of contents, asks for a short summary with the details written to a file, and picks the cheapest model that fits the task.
- **Stays within limits.** It follows the agent limits in `PROJECT.md`. By default it only prepares drafts and proposals: it never sends, publishes, deploys, merges to main, buys or emails.

## What it reads, and when

`CLAUDE.md` is loaded into every session and every scheduled run, so it is kept as small as possible.

| File | When it is read |
|---|---|
| `CLAUDE.md` | Always, at startup |
| `PROJECT.md` | Always, at startup, imported by `CLAUDE.md` with `@PROJECT.md`: goal, constraints, agent limits and project rules |
| `scope.md` | Before proposing an approach, a plan or agents; before calling work done; when a request may be out of scope: context, out of scope, success criteria, tools, pace |
| `decisions.md` | Before proposing an approach, a plan or agents, or when a decision is cited |
| `open.md` | For status questions, or when an open or parked topic comes up |
| `archive.md` | Only when a cited ID is not in the other files |

`PROJECT.md` holds only what the lead agent needs at every turn, because it is paid at every call, heartbeats included. A carefully interviewed brief is long, and that is normal: nothing in it is dropped, the rest goes to `scope.md` and is paid only in the turns that read it. On a real brief (an app for climbing competitions), the old single `PROJECT.md` was 1,600 tokens, 592 of them for the success criteria alone; split, `PROJECT.md` is 617 tokens and `scope.md` about 1,000.

To keep the files that are read on demand light, the lead agent moves closed entries from `open.md` and long-superseded decisions to `archive.md`. Their IDs stay the same.

## Project rules

`CLAUDE.md` comes from the template, and template files are replaced when the project is updated to a newer Jérôme version with [`jerome update`](commands/update.md). Rules that belong to one project only, such as conventions, tools to prefer or things to avoid, go in `PROJECT.md` under a `## Project rules` section, one line per rule:

```markdown
## Project rules
- Use pnpm, never npm.
- Tests run with `pnpm test` before every commit proposal.
```

The lead agent adds the section when the first rule comes up, and `CLAUDE.md` tells it never to write rules into itself. `PROJECT.md` is a state file that updates never touch, and it is already loaded at startup, so the rules cost nothing extra beyond their own lines. They count towards `PROJECT.md`'s budget.

## Projects from before `scope.md`

Projects created before `scope.md` existed have all the brief's sections in `PROJECT.md`. `jerome doctor` warns about it and names the sections to move. To migrate:

1. run `jerome update`, so `CLAUDE.md` knows about `scope.md`;
2. ask the lead agent: "move Context, Out of scope, Success, Tools, Pace and usage from PROJECT.md to scope.md, unchanged".

## A project started from free text

When `jerome new --from-file` gets a text that is not a valid brief, it saves the text in `brief.md` and writes a provisional `PROJECT.md` whose only content is an instruction for the lead agent (see [new.md](commands/new.md#importing-a-brief)). Since `PROJECT.md` is loaded at startup, the lead agent sees it in the first session and, before any other task:

1. converts `brief.md` with the `project-brief` skill;
2. lists the decisions it found and asks you to confirm them in one block, because the text may come from another chat and hold proposals you never confirmed;
3. writes `PROJECT.md`, `scope.md`, `decisions.md` and `open.md`, replacing the provisional file, and leaves `brief.md` as the original text.

The instruction lives in `PROJECT.md` and not in `CLAUDE.md`, so it costs tokens only until the conversion. Until then, `jerome doctor` warns that the project is provisional, and scheduled runs (planned) will not start on it.

## Token budget

| File | Budget | Current |
|---|---:|---:|
| `CLAUDE.md` | 650 tokens | 604 |
| `PROJECT.md` | 800 tokens | depends on the brief: 244 and 617 in two real projects |

`jerome doctor` warns when a file goes over its budget. It never blocks anything: budgets make the cost visible, they do not limit what a project can be. When a project really needs more context loaded at every turn, raise its budgets in `.jerome`:

```json
{
  "schema": "jerome.project/v1",
  "budgets": { "PROJECT.md": 1200 }
}
```

Only `CLAUDE.md` and `PROJECT.md` have budgets. Invalid entries are reported by `jerome doctor` and the defaults apply. `jerome update` keeps the field.

Measured in phase 2 on a project created with `jerome new`, with a 614-token `PROJECT.md` and a 496-token `CLAUDE.md`:

| | Without `CLAUDE.md` | With `CLAUDE.md` and `PROJECT.md` |
|---|---:|---:|
| Estimated startup context (`/context`) | 10.4k | 11.5k |
| Input tokens of one real call | 12,348 | 13,735 |

So the lead agent's instructions and the project summary add about 1.4k tokens to every call.

## Subagents

Claude Code also loads `CLAUDE.md`, and the files it imports, into subagents. In the same test project a trivial subagent call cost 2,518 input tokens with it and 1,142 without. For this reason:

- the agents that Jérôme's catalog will provide set `omitClaudeMd: true` and skip the file entirely;
- built-in subagents still load it, and its second line tells them to ignore it.

## Service calls

Some runs are not the lead agent's work, for example the documentation agent behind `jerome docs`. When the CLI launches `claude -p` for them, it:

- starts from a service folder outside the project, so the lead agent's `CLAUDE.md` is not loaded;
- passes `--settings` with the project's `.claude/settings.local.json`, so the lean profile still applies. Without it, a folder outside the project gets every plugin, skill and connector you have installed: 14.1k tokens instead of 10.4k on the test machine;
- passes `--no-session-persistence`, so the run leaves no transcript that would be counted as project usage;
- adds the project with `--add-dir` only when the task needs its files. `CLAUDE.md` still stays out, while the project's skills come in.

The service folder is one fixed path per project, emptied before each call, because Claude Code keeps a small folder in `~/.claude/projects/` for every folder it is started from.
