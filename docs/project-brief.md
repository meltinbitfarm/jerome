# The briefing

Every Jérôme project starts from a brief: a short, structured document with the project's goal, constraints, decisions and open questions. The contract is the brief's format, `brief/v2`, not a particular tool: you can run the briefing wherever you like, and the CLI imports any brief in that format.

## How a briefing goes

You describe what you want to build, even in long, dictated messages. The model asks one question at a time, challenges choices that cost tokens or add complexity, and records each decision with its reason. When you are done, say "save the brief". Before writing it, the model lists the decisions it proposed and you never explicitly confirmed, and asks you to confirm them in one block: silence is not confirmation, and whatever you don't confirm goes under Open questions.

The briefing happens in the language you write in. The brief's section headings stay in English, so the CLI can read any brief.

## Where to run it

| Where | How | What you get |
|---|---|---|
| Claude Code, inside a Jérôme project | The template's `project-brief` skill: say "I have an idea" or "let's do the briefing" | The brief split into `PROJECT.md`, `decisions.md` and `open.md`, with a full copy in `brief.md` |
| Any chat: claude.ai, ChatGPT, Gemini… | Paste the output of [`jerome prompt`](commands/prompt.md) as your first message | The brief in a single markdown block, to copy |
| claude.ai, with the skill uploaded (optional) | The same skill as in Claude Code | The brief in a single markdown block, to copy |

To bring a brief from a chat into a new project, copy it and run:

```sh
pbpaste | jerome new my-project --from-file -
```

or save it to a file and pass its path instead of `-`. On a phone, copy the brief later from the chat history on your computer. See [`jerome new`](commands/new.md#importing-a-brief) for what the import does, including with a text that is not a valid brief.

## `jerome prompt` and the skill

Both use the same files, in the skill's `references/` folder:

- `briefing.md`, how to run the briefing and close it;
- `brief-v2.md`, the format.

`jerome prompt` prints them, without the parts that only make sense in Claude Code, so the instructions you paste into a chat always match the installed version of Jérôme.

## Uploading the skill to claude.ai (optional)

If you prefer the skill to a pasted prompt on claude.ai, upload it there. From the root of this repository, build a zip that contains the `project-brief` folder:

```sh
mkdir -p dist && (cd template/.claude/skills && zip -r -X ../../../dist/project-brief.zip project-brief -x '*.DS_Store')
```

Then upload `project-brief.zip` in the Skills section of your claude.ai settings. If you uploaded an earlier version, replace it.

## Format

The format is `brief/v2`, described in [`references/brief-v2.md`](../template/.claude/skills/project-brief/references/brief-v2.md). Briefs in the older `brief/v1` format, which had Italian section headings, are still accepted on import.
