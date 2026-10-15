# `jerome deps [--json]`

Lists what Jérôme depends on in Claude Code and could break with a Claude Code release: commands and flags, the fields it reads from hook payloads, transcripts, results, streams and the status line, the `/context` sections it parses, the settings and files it writes or reads, and behaviours it relies on. Each entry names the decisions and the code that use it.

```sh
jerome deps          # readable list; * marks what Claude Code does not document
jerome deps --json   # for tools that watch Claude Code releases
```

The list comes with the installed Jérôme, so a tool that reads it, such as claude-watch, follows Jérôme's own changes without being edited: when a phase starts using a new field, the list says so. Keeping it current is part of finishing every phase, and a test fails when the code reads a field from Claude Code that the list lacks.

## `--json`

One JSON object on standard output and nothing else:

```json
{
  "schema": "jerome.deps/v1",
  "jerome": "0.1.0",
  "verifiedOn": ["2.1.299", "2.1.300"],
  "items": [
    {
      "area": "hook-input",
      "event": "PreToolUse",
      "path": "tool_input.command",
      "kind": "field",
      "presence": "always",
      "documented": true,
      "decisions": ["D49", "D61"],
      "phase": 6,
      "code": ["src/hooks.js"],
      "use": "the chained-command check, the second protection of D49",
      "note": "for tool_name \"Bash\""
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `schema` | `jerome.deps/v1`. New fields or areas may be added within v1; renaming or removing a field, or changing its meaning, bumps the version. A reader should stop interpreting the rest when it does not know the schema. |
| `jerome` | Version of the Jérôme that printed the list. |
| `verifiedOn` | Claude Code versions the list was checked against. |
| `area` | Where the entry lives: `cli`, `result` (of `-p --output-format json`), `stream` (of `stream-json`), `transcript`, `subagent-meta` (a subagent's `.meta.json`), `hook-config`, `hook-input`, `hook-output`, `statusline-config`, `statusline-input`, `context` (`/context` output), `settings`, `files`, `behaviour`, `model`. |
| `event` | For hooks, the event (`*` for every event); for streams and transcripts, the line or event type; otherwise `null`. |
| `path` | The field as a dotted path (`[]` for array items), or the command, flag, file, section or behaviour. |
| `kind` | `field`, `flag`, `command`, `file`, `section`, `setting`, `env`, `behaviour` or `model`. |
| `presence` | `always`: Claude Code always provides it, so missing means broken. `sometimes`: it may be absent, so only its type can be checked when present. |
| `documented` | `false` when Claude Code's documentation does not describe it: the likeliest to change. |
| `decisions`, `phase` | The decisions that rely on it, and the phase that introduced it. |
| `code` | The files that use it. |
| `use`, `note` | What Jérôme does with it, in a few words. |

A field check uses `area`, `event`, `path` and `presence`: for example, every `hook-input` field of kind `field` with `presence: "always"` must appear in the payloads of its event.
