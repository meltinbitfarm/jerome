# Hooks and status line

Jérôme records what happens in a project through Claude Code's hooks, so the model spends no tokens on it. `jerome doctor` (run by `jerome new`) writes them into the project's `.claude/settings.json`, next to any hooks the project already has, and `jerome doctor --check` fails while one is missing.

| Event | Runs | What it does |
|---|---|---|
| `SessionStart` | synchronously | opens the session's run (or reopens it on resume), applies the [retention policy](database.md#retention), and in an interactive session tells the lead agent about the decision requests that scheduled runs left open |
| `SubagentStop` | in the background | reads the subagent's transcript, and records the length of its reply |
| `Stop` | in the background | reads the new lines of the session's transcript |
| `SessionEnd` | synchronously, up to 10 seconds | reads whatever is left in the session's and subagents' transcripts, and closes the run with its reason |
| `PreToolUse` on Bash | synchronously | refuses chained commands that change the repository (below) |

Each hook runs `jerome hook <event>`. Hooks never make a session fail: they always exit with code 0, and an error is recorded as an `error` event in the [database](database.md). Each event records how long its hook took: on a real project, 18 to 24 milliseconds.

`Stop` and `SubagentStop` run in the background, so they never slow the session down. Two things can make them miss calls: `claude -p` cancels background hooks still running when it exits, and at `Stop` the transcript may not hold the final message yet. `SessionEnd` reads whatever they missed, and since every transcript is read from where the last read stopped, nothing is counted twice. On a real project, the usage the hooks recorded matched an independent count of the transcripts exactly, in an interactive session and in a `claude -p` run.

The run's kind is `interactive` for any session you start, `claude -p` included. Jérôme's own checks, such as the `/context` run of `jerome doctor`, set `JEROME_HOOKS=off`, so they are not recorded as runs. Jérôme's own launchers set `JEROME_RUN_KIND` to `heartbeat` or `service`. `jerome docs` runs outside the project, so no hook sees it: the CLI records it as a `service` run itself.

## Chained commands

The lead agent runs commands that change the repository one at a time, checking each result before the next. `CLAUDE.md` says so, and the `PreToolUse` hook enforces it: a Bash command that chains a git command changing the repository with anything else is refused, with a reason that lists the parts to run separately:

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

Agents reply in at most 150 words. At every `SubagentStop` the hook records the reply's words, lines and whether it has nested lists, never its text. A subagent running in the background replies through its handback message rather than a final text, which is read from its transcript. To see the figures (here from a project whose analyst was only asked to count lines):

```
$ jerome state --replies
...
replies 7d: analyst avg 1w max 1 (0/2 over 150)
```

## Status line

If the project has no status line of its own, `jerome doctor` sets `jerome statusline`. It:

1. records the subscription's 5-hour and 7-day windows in `~/.config/jerome/account.json`, only when they change;
2. runs your own status line, from your user settings, with the same input;
3. prints it with Jérôme's part appended, or Jérôme's part alone:

```
5h 32% · 7d 20% · today ≈$2.41 API
```

`today` is the project's usage since midnight at API prices: a subscription is not billed per token. Claude Code sends the windows only after the first response of a session.

If the project or your local settings already set another status line, `jerome doctor` leaves it and warns that interactive sessions will not record the windows. To keep both, make it call `jerome statusline` instead: your user status line still shows, with Jérôme's part after it.
