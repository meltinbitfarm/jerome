# Hooks and status line

Jérôme records what happens in a project through Claude Code's hooks, so the model spends no tokens on it. `jerome doctor` (run by `jerome new`) writes them into the project's `.claude/settings.json`, next to any hooks the project already has, and `jerome doctor --check` fails while one is missing.

| Event | Runs | What it does |
|---|---|---|
| `SessionStart` | synchronously | opens the session's run, or reopens it on resume; `/clear` and a fork start a session with a new id, so a run of their own, and the calls a fork copies from its original are counted once, applies the [retention policy](database.md#retention), and in an interactive session gives the lead agent the open [heartbeat alerts](heartbeat.md#alerts) first, then the decision requests that scheduled runs left open, in full, and the assumptions of `open.md` waiting for you |
| `SubagentStop` | in the background | reads the subagent's transcript, and records the length of its reply |
| `Stop` | in the background | reads the new lines of the session's transcript |
| `SessionEnd` | synchronously, up to 10 seconds | reads whatever is left in the session's and subagents' transcripts, and closes the run with its reason |
| `PreToolUse` on Bash | synchronously | refuses chained commands that change the repository, staging everything instead of named paths, and, in your sessions while a heartbeat runs, any git command that changes the repository (below) |

Each hook runs [`jerome hook <event>`](commands/hook.md). Hooks never make a session fail: they always exit with code 0, and an error is recorded as an `error` event in the [database](database.md). Each event records how long its hook took: on a real project, 18 to 24 milliseconds.

`Stop` and `SubagentStop` run in the background, so they never slow the session down. Two things can make them miss calls: `claude -p` cancels background hooks still running when it exits, and at `Stop` the transcript may not hold the final message yet. `SessionEnd` reads whatever they missed, and since every transcript is read from where the last read stopped, nothing is counted twice. On a real project, the usage the hooks recorded matched an independent count of the transcripts exactly, in an interactive session and in a `claude -p` run.

The run's kind is `interactive` for any session you start, `claude -p` included. Jérôme's own checks, such as the `/context` run of `jerome doctor`, set `JEROME_HOOKS=off`, so they are not recorded as runs. Jérôme's own launchers set `JEROME_RUN_KIND` to `heartbeat` or `service`. `jerome docs` runs outside the project, so no hook sees it: the CLI records it as a `service` run itself.

## Open decision requests at session start

When scheduled runs left decision requests open, `SessionStart` gives the lead agent each one in full: the question, the options, the recommendation, and the content of the project files they cite, such as a note the heartbeat wrote. A cited file over 6,000 characters, or beyond 12,000 characters in all, is only named. The lead agent can then put the requests to you in its first reply, without exploring: on a real project, before the deny rules of D80, the first reply after "ciao" went from 4 calls and 131,000 tokens to one call and 32,600 tokens, and it asked before closing a request that later decisions had made moot.

The [assumptions](lead-agent.md#questions-and-assumptions) in `open.md`, minor choices the lead agent made without asking, come after the requests, one line each, so it puts them to you in one block too. With no requests and no assumptions, the hook adds nothing.

## Heartbeat alerts at session start

When the project's autonomous runs have open [alerts](heartbeat.md#alerts), `SessionStart` puts them before everything else, telling the lead agent to bring them up first in its first reply, and shows you a line of its own (`Jérôme: 1 heartbeat alert: A3 …`) with `systemMessage`.

## Limits at session start

When a global or project limit is at 90% or more, `SessionStart` shows you a warning, with `systemMessage`, so the model pays nothing for it. The session is not blocked. See [limits.md](limits.md).

## Chained commands

The lead agent runs commands that change the repository one at a time, checking each result before the next. `jerome.md` says so, and the `PreToolUse` hook enforces it: a Bash command that chains a git command changing the repository with anything else is refused, with a reason that lists the parts to run separately:

```
Run commands that change the repository one per Bash call, and check each result before the next (Jérôme D49). Split this into separate calls:
1) git add -A
2) git commit -m "Fix the parser"
```

- **Refused:** `git add -A && git commit -m x`, `npm test && git merge task/x`, `cd sub && git commit -m x`, `git switch main; git merge task/x`.
- **Allowed:** chained reads such as `git status && git diff` or `git log | head`, and any single command.
- **Never counted as a chain:** what is inside quotes, heredocs, `$(…)` or backticks. A commit message with `&&` or `;` in it is fine, whether in quotes, in `git commit -F - <<'EOF' … EOF`, or in `git commit -m "$(cat <<'EOF' … EOF)"`.

Changing commands are `add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `rm`, `mv`, `cherry-pick`, `revert`, `pull`, `push`, `clean`, `am`, `apply`, `init`, `update-ref`, `switch` and `checkout` with arguments, `stash` except `list` and `show`, `tag` except listing, `branch` when it creates, deletes or moves a branch, and `worktree add`, `remove`, `move` and `prune`. The hook applies to subagents too, and records a `blocked` event with the subcommands, never the command. Commands inside `bash -c '…'` or scripts are not inspected.

## Reply lengths

Agents reply in at most 150 words. At every `SubagentStop` the hook records the reply's words, lines and whether it has nested lists, never its text. Claude Code's own helpers, such as the one that titles a session, also stop as subagents, with no type and no transcript: their stops are recorded but not counted as replies. A subagent running in the background replies through its handback message rather than a final text, which is read from its transcript. To see the figures (here from a project whose analyst was only asked to count lines):

```
$ jerome state --replies
...
replies 7d: analyst avg 1w max 1 (0/2 over 150)
```

## Status line

If the project has no status line of its own, `jerome doctor` sets [`jerome statusline`](commands/statusline.md). It:

1. records the subscription's 5-hour and 7-day windows in `~/.config/jerome/account.json`, only when they change;
2. runs your own status line, from your user settings, with the same input;
3. prints it with Jérôme's part appended, or Jérôme's part alone:

```
5h 57%/70% · 7d 22%/75% · today ≈$3.36/$5 API
```

Each figure is shown against its limit and coloured by how close it is: green, yellow from 75%, red from 90%, bold red beyond the limit.

When the project has no database, for example after its folder moved, Jérôme's part reads `no database: run jerome doctor`.

`today` is the project's usage since midnight at API prices: a subscription is not billed per token. Claude Code sends the windows only after the first response of a session.

If the project or your local settings already set another status line, `jerome doctor` leaves it and warns that interactive sessions will not record the windows. To keep both, make it call `jerome statusline` instead: your user status line still shows, with Jérôme's part after it.

## Staging named paths

In every session, heartbeats included, the `PreToolUse` hook refuses `git commit -a` (and `-am`, `--all`), `git add -A`, `--all`, `-u`, `--update`, `.` and `:/`, with a reason asking to stage the paths the task changed by name (D125). They sweep in whatever else is changed in the tree, such as your own edits: this is how a lead agent once committed a change of the user's along with its own. `git add -p`, `git commit --amend` and named paths are allowed. It is checked after the chain check, which it leaves as it was.

## Sessions working alongside a heartbeat

While a heartbeat holds the project's lock, the hook refuses, in any session that is not the heartbeat's own, the git commands that change the repository (the same list as the chain check: `commit`, `add`, `switch`, `checkout <x>`, `merge`, `stash`, `branch -d`…), with a reason naming the heartbeat's pid and suggesting a separate worktree; `git worktree add` itself is let through (D122). Reading and editing files stay allowed. A worktree has its own folder, so its sessions are never refused. See [heartbeat.md](heartbeat.md#working-alongside-a-heartbeat).

