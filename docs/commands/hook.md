# `jerome hook <event>`

Run by Claude Code, not by you: `jerome doctor` writes one hook per event into the project's `.claude/settings.json`. The event is one of `session-start`, `subagent-stop`, `stop`, `session-end` and `pre-tool-use`, and Claude Code passes its payload on standard input.

- It records the session's run, usage, events and reply lengths in the project [database](../database.md), and refuses chained commands that change the repository. What each event does: [hooks.md](../hooks.md).
- It never makes a session fail: it always exits with 0, and an error becomes an `error` event when the database can be opened.
- It records nothing outside a Jérôme project, when the project has no database (run `jerome doctor`), or when `JEROME_HOOKS=off`, which Jérôme's own checks set.
