# The lead agent

Every Jérôme project has one lead agent: the main Claude Code session you talk to. Its instructions live in the project's `CLAUDE.md`, which comes from the template.

## What it does

- **Speaks your language**, briefly, with at most one question per reply.
- **Keeps the project state.** It is the only one that edits `PROJECT.md`, `decisions.md` and `open.md`. Subagents report to it, and it records what matters.
- **Respects decisions.** It cites entries by ID ("see D4") and does not reopen a recorded decision unless a concrete problem appears.
- **Asks when it must.** When you need to decide, it ends with a decision request: the question, the options and its recommendation.
- **Delegates cheaply.** It uses subagents, never agent teams. It passes file paths instead of contents, asks for a short summary with the details written to a file, and picks the cheapest model that fits the task.
- **Stays within limits.** It follows the agent limits in `PROJECT.md`. By default it only prepares drafts and proposals: it never sends, publishes, deploys, merges to main, buys or emails.

## What it reads, and when

`CLAUDE.md` is loaded into every session and every scheduled run, so it is kept as small as possible.

| File | When it is read |
|---|---|
| `CLAUDE.md` | Always, at startup |
| `PROJECT.md` | Always, at startup, imported by `CLAUDE.md` with `@PROJECT.md` |
| `decisions.md` | Before proposing an approach, or when a decision is cited |
| `open.md` | For status questions, or when an open or parked topic comes up |
| `archive.md` | Only when a cited ID is not in the other files |

To keep the files that are read on demand light, the lead agent moves closed entries from `open.md` and long-superseded decisions to `archive.md`. Their IDs stay the same.

## Token budget

| File | Budget | Current |
|---|---:|---:|
| `CLAUDE.md` | 600 tokens | 496 |
| `PROJECT.md` | about 800 tokens | depends on the brief |

`jerome doctor` warns when a file goes over its budget. It does not block anything.

Measured on a project created with `jerome new`, with a 614-token `PROJECT.md`:

| | Without `CLAUDE.md` | With `CLAUDE.md` and `PROJECT.md` |
|---|---:|---:|
| Estimated startup context (`/context`) | 10.4k | 11.5k |
| Input tokens of one real call | 12,348 | 13,735 |

So the lead agent's instructions and the project summary add about 1.4k tokens to every call.

## Subagents

Claude Code also loads `CLAUDE.md`, and the files it imports, into subagents. In the same test project a trivial subagent call cost 2,518 input tokens with it and 1,142 without. For this reason:

- the agents that Jérôme's catalog will provide set `omitClaudeMd: true` and skip the file entirely;
- built-in subagents still load it, and its second line tells them to ignore it.
