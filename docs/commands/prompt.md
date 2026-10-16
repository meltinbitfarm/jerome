# `jerome prompt`

Prints the briefing instructions of the installed Jérôme version, to paste into any chat: claude.ai, ChatGPT, Gemini or others.

```sh
jerome prompt | pbcopy
```

Paste them as the first message, then describe your idea. The model runs the briefing one question at a time, in your language. When you say "save the brief", it lists the decisions it proposed for you to confirm, then writes the brief in a single markdown block in the `brief/v2` format. Copy it and import it:

```sh
pbpaste | jerome new my-project --from-file -
```

## What it prints

The instructions are built from the same files the `project-brief` skill reads, `references/briefing.md` and `references/brief-v3.md`, so the prompt and the skill never drift apart. The parts that only make sense in Claude Code, such as writing project files or importing, are left out. The first lines say which Jérôme version generated them.

The prompt is in English, which every model follows well; the briefing and the brief's content are in the language you write in.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Instructions printed |
| 2 | Wrong usage |
