# Agents and limits

The lead agent delegates work to subagents. Each project has its own team in `.claude/agents/`, created from Jérôme's catalog after you approve it.

## The catalog

The catalog ships with the template, inside the `project-team` skill (`.claude/skills/project-team/agents/`). It costs nothing until an agent is created, because Claude Code lists only the agents in `.claude/agents/`.

| Agent | Model | For | Tools |
|---|---|---|---|
| developer | opus | code: features, fixes, refactors, tests | Read, Edit, Write, Bash, Grep, Glob |
| writer | opus | text that stays: specifications, content, copy | Read, Edit, Write, Grep, Glob |
| researcher | sonnet | research on the web and in the project | Read, Grep, Glob, WebSearch, WebFetch, Write |
| analyst | sonnet | analysis of code, data or documents, reviews | Read, Grep, Glob, Bash, Write |
| clerk | haiku | mechanical work: counts, extractions, conversions, formatting | Read, Grep, Glob, Bash, Write |
| documentarist | haiku | brings `docs/_pending.md` into `docs/` | Read, Edit, Write, Grep, Glob |

The model follows the kind of work, not a hierarchy: Opus where the result stays (code, lasting text), Sonnet for research and analysis, Haiku for mechanical work. The lead agent runs on whatever model you pick for the session.

Every agent:

- declares its `model` and only the `tools` it needs;
- sets `omitClaudeMd: true`, so it loads neither `CLAUDE.md` nor `PROJECT.md`: a subagent call costs about 1.1k input tokens instead of 2.5k (see [lead-agent.md](lead-agent.md#subagents)). The lead agent passes it file paths, not contents;
- replies in **at most 150 words**, in short lines without nested lists: the outcome, the files it wrote, and what the lead agent must decide. Details go in the files it writes, or in `notes/YYYY-MM-DD-<agent>-<topic>.md`. The limit holds even when the task asks for more, and `CLAUDE.md` tells the lead agent not to ask for more;
- appends one line to `docs/_pending.md` when it changes something relevant, for the documentarist (see [`jerome docs`](commands/docs.md)). The researcher and the analyst change nothing, so they never do;
- holds the default limits and a `## Project limits` section in its own file.

## Building the team

Ask the lead agent, for example "propose the team of agents from the brief". With the `project-team` skill it:

1. reads `scope.md` and `decisions.md`;
2. proposes the smallest team that covers the work: each agent with its task in this project, model, tools and reason, ending with a decision request;
3. after your explicit confirmation, writes the agents to `.claude/agents/`, copies into each one the Agent limits from `PROJECT.md` that apply to it, and records the team as a decision.

Nothing is created before you confirm. Claude Code protects the `.claude/` folder, so in a session it also asks you to approve each agent file the lead agent writes, even in "accept edits" mode. In a test on a real project, the lead agent proposed three agents (developer, analyst, documentarist), skipped the other three with a reason each, and recorded the team only after the files existed.

## Changing an agent

To change an agent's model, tools or role, ask the lead agent: it edits the file and records the decision. It never changes a model on its own; when it sees a reason, it proposes the change with a decision request.

When `PROJECT.md`'s Agent limits change, the lead agent updates the `## Project limits` section of every agent in the same turn. Agents do not read `PROJECT.md`, so a limit missing from their file does not exist for them.

The files in `.claude/agents/` belong to the project. [`jerome update`](commands/update.md) never touches them, even when they came from the catalog: a newer catalog reaches existing agents only if you ask the lead agent to apply it. [`jerome doctor`](commands/doctor.md) warns about an agent without a declared model or without `omitClaudeMd: true`.

## Binding limits

By default the lead agent and its agents only prepare drafts: they never send, publish, deploy, push, buy or email. Tasks run on branches, and only the lead agent merges them into `main`, when the tests pass and there are no conflicts; agents never merge. Written rules can be ignored, so the commands that do those things are also denied by Claude Code. `jerome new` (through `jerome doctor`) writes permission rules into the project's `.claude/settings.json`, which is versioned. Deny rules come first:

| What | Denied commands |
|---|---|
| Pushing | `git push *`, `git -C * push *` |
| GitHub | `gh pr merge *`, `gh release create *` |
| Packages and images | `npm publish *`, `pnpm publish *`, `yarn publish *`, `yarn npm publish *`, `bun publish *`, `cargo publish *`, `twine upload *`, `uv publish *`, `poetry publish *`, `gem push *`, `docker push *` |
| Deploying | `vercel`, `vercel deploy *`, `vercel --prod *`, `netlify deploy *`, `firebase deploy *`, `fly deploy *`, `flyctl deploy *`, `wrangler deploy *`, `wrangler publish *`, `wrangler pages deploy *` |
| Email | `sendmail *`, `mail *`, `mailx *` |

Each rule is written as `Bash(<command>)`. Tested on Claude Code 2.1.300, the rules block the command:

- in the main session and in subagents, built-in or from `.claude/agents/`;
- in interactive and headless sessions, even with `--dangerously-skip-permissions` or with an allow rule such as `Bash(git *)`;
- inside compound commands (`cd x && git push`) and after environment variables (`FOO=1 git push`).

They are a safety net for the common commands, not a sandbox. A command they do not list, such as an unusual form of `git` or a deploy tool not in the table, still relies on the written limits. Buying, and sending email through a connector, cannot be expressed as rules at all.

### Allowed and asked

The safe local operations of a task are allowed, so that Claude Code's auto mode never takes them for something else: a merge into `main` blocked as if it were a deploy, or even a `git status` blocked.

| What | Allowed commands |
|---|---|
| Reading the repository | `git status *`, `git log *`, `git diff *`, `git show *`, `git rev-parse *`, `git merge-base *`, `git stash list *` |
| Branches and merges | `git add *`, `git commit *`, `git switch *`, `git checkout *`, `git branch *`, `git merge *` |
| Jérôme | `jerome state *` |
| Tests | `npm test`, `pnpm test`, `yarn test`, `bun test`, `node --test`, `pytest`, `cargo test`, `go test ./...` |

The test commands are exact, because auto mode drops wildcarded package-manager and interpreter rules. If a project runs its tests differently, ask the lead agent to add that exact command.

Some forms of the allowed commands discard work: an allow rule would approve them without the checks auto mode normally applies, so they always ask (in a headless run, asking means refusing): `git checkout -- *`, `git checkout * -- *`, `git checkout .`, `git checkout -f *`, `git switch -f *`, `git switch --discard-changes *`, `git branch -D *`, `git commit --amend *`.

Deny wins over ask, and ask over allow. Tested on Claude Code 2.1.300 in a throwaway repository: in `dontAsk` mode, where only allowed commands run, every allowed command ran, the asked ones were refused and `git push` was denied; in auto mode the result was the same, the asked ones turning into permission requests.

**Trust.** Claude Code ignores the allow rules of a project's `.claude/settings.json` until you have opened `claude` in that folder once and accepted the trust dialog; deny rules apply anyway. Opening the project after `jerome new` does it, and `jerome doctor` warns (`trust`) while it is missing. Scheduled runs will need it too.

### Keeping the rules

`jerome doctor` adds any missing rule and keeps your own settings and rules; `jerome doctor --check` fails while one is missing. To run a denied command yourself, type it with `!` in the session (for example `! git push`) or in a terminal: the rules apply to the model, not to you.

Jérôme's own development repository is skipped, since pushing is part of developing Jérôme.
