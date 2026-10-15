# `jerome docs [dir]`

Brings the entries of the documentation queue, `docs/_pending.md`, into the project's documentation in `docs/`, with the documentarist agent on Haiku. `dir` defaults to the current directory.

```sh
cd my-project
jerome docs
```

In a session, type `/docs` instead: the lead agent runs the same agent as a subagent.

## The queue

Agents do not update the documentation while they work, which would cost tokens on every task. When one changes something relevant, it appends one line to `docs/_pending.md`:

```
- 2026-10-15 · developer · src/greet.js · Added greet(name), which returns an Italian greeting.
```

The documentarist reads each entry, updates the page it belongs to (or creates one when none fits), and removes the entry from the queue. An entry it cannot integrate stays, with ` — not integrated: <reason>` appended. [`jerome doctor`](doctor.md) warns when the queue holds more than 20 entries.

## What it does

1. If the queue has no entries, it says so and stops, without calling Claude Code.
2. It takes the project's documentarist, `.claude/agents/documentarist.md`, so a model you changed is respected; without one, the catalog's.
3. It runs it headless as a service call:
   - from a fixed folder outside the project, under `~/.cache/jerome/service/` (or `$XDG_CACHE_HOME`), emptied before and after the call, so the lead agent's `CLAUDE.md` and `PROJECT.md` are not loaded;
   - with `--settings` pointing to the project's `.claude/settings.local.json`, so the lean profile applies;
   - with `--no-session-persistence`, so it leaves no transcript;
   - with `--add-dir` for the project, and write access only to the project's `docs/`.
4. It prints the agent's reply, in at most 150 words, and how many entries left the queue.

On two test projects, integrating one entry took 10 and 23 seconds; on one of them the documentarist created a page, since none fit, in the project's language.

The project's `.claude/settings.local.json` must exist: run [`jerome doctor`](doctor.md) first if it does not.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Queue empty, or the documentarist ran |
| 1 | Not a Jérôme project, no local settings, or the call failed |
| 2 | Wrong usage |
