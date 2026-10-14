---
name: project-brief
description: Runs the initial briefing for a new project and saves it in the brief/v2 format. Use it whenever the user wants to start a new project, product, tool or feature ("I have an idea", "I was thinking of building", "let's do the briefing", "new project", or the same in any language), when they say "save the brief", "close the brief", "the brief is ready", or when they ask to import a brief into a project folder. Works on claude.ai (including from a phone, often with dictated messages) and in Claude Code, inside or outside a Jérôme project.
---

# Project brief

The briefing is where every project starts. The goal is to reach, with a few targeted questions, a compact brief that a lead agent in Claude Code can read with few tokens and use to propose the agents.

The format is in `references/brief-v2.md`: read it before writing or importing a brief.

## Language

- Hold the briefing in the language the user writes in, and write the brief's content in that language too.
- Front matter keys, section headings and ID prefixes stay exactly as in the format, in English: tools parse them.

## How to run the briefing

- **Free-form input.** Users often dictate: long, messy messages with transcription errors. Interpret them without pointing it out and don't ask them to rephrase.
- **One question at a time.** End each reply with only the most important open point. Never a list of questions.
- **Critical spirit.** Say frankly what already exists (check with a search when you talk about current tools or features), what costs tokens, what is fragile or overly complex. Don't agree just to be polite.
- **Short replies.** The user may be reading on a phone: get to the point, no preambles.
- **Keep track.** Every choice made is a decision with its reason. Don't reopen decisions already made, unless a concrete problem comes up, and in that case say so explicitly.
- **Parking.** When the user puts a topic on hold, record it as parked and don't bring it up again until they reopen it.
- **No agents in the brief.** The lead agent proposes the team after reading the brief. If the user already has ideas about agents, note them under Context.

## When the user asks to save the brief

1. Write the brief following `references/brief-v2.md`, using only what came up in the conversation. Whatever was not decided goes under Open questions: don't make it up.
2. `status: ready` only if the user says it is ready or that development starts now; otherwise `draft`.
3. Save it according to where you are (next section).
4. Reply in 2–3 lines: where you saved it, how many decisions and open questions it contains, and the command or phrase to pick it up again.

## Where to save

**Inside a Jérôme project** (the folder root contains the `.jerome` marker file):
- Write the project files directly, as described under "Import" in `references/brief-v2.md`.
- Also save a copy of the full brief as `brief.md`.

**Anywhere else** (claude.ai, phone, Claude Code outside a Jérôme project), pick the store in this order:
1. In Claude Code, if `~/.config/jerome/config.json` sets `"storage"`, use that adapter, or no store if it is `"none"`.
2. Otherwise, if the tools of a supported store are available in this session, use that store.
3. Otherwise show the brief in a markdown block to copy, and say so clearly.

Each store has its own adapter in `references/storage-<name>.md`. Read only the one you are using. Supported today: `mementovault`.

## Import (Claude Code only)

When the user asks to import a brief into a Jérôme project:
1. Get the brief from the store, following its adapter, or from a file or text the user provides.
2. Check the `format` field. `brief/v2` is imported as is. `brief/v1` is accepted: map its section headings with the table in `references/brief-v2.md`. With any other value, stop and report the version.
3. Sort the sections into the files as described under "Import" in `references/brief-v2.md`, and confirm in one line.
4. Propose the team of agents only after the import, as a separate step for the user to approve.
