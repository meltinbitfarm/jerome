# `jerome statusline`

Run by Claude Code as the project's status line, not by you: `jerome doctor` sets it in `.claude/settings.json` when the project has no status line of its own. Claude Code passes the session's data on standard input.

It records the subscription windows in `~/.config/jerome/account.json` when they change, runs your own status line with the same input, and appends Jérôme's part:

```
⚠ 1 alert · 2 requests · 5h 57%/70% · 7d 22%/75% · today ≈$3.36/$5 API · ♥ heartbeat running
```

The open alerts and decision requests come first, and `♥ heartbeat running` last while a heartbeat runs (D137).

When the project has no database, for example after its folder moved, the part reads `no database: run jerome doctor` (see [database.md](../database.md#where-it-lives)). It never fails: whatever goes wrong, it prints what it can. Details: [hooks.md](../hooks.md#status-line).
