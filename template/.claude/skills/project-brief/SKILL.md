---
name: project-brief
description: Runs the initial briefing for a new project and saves it in the brief/v2 format. Use it whenever the user wants to start a new project, product, tool or feature ("I have an idea", "I was thinking of building", "let's do the briefing", "new project", or the same in any language), when they say "save the brief", "close the brief", "the brief is ready", or when they ask to import or convert a brief in a project folder. Works on claude.ai (including from a phone, often with dictated messages) and in Claude Code, inside or outside a Jérôme project.
---

# Project brief

Read `references/briefing.md` for how to run the briefing and close it, and `references/brief-v2.md` for the format, before writing or importing a brief.

## Where the brief goes

**Inside a Jérôme project** (the folder root contains the `.jerome` marker file):
- Write the project files directly, as described under "Import" in `references/brief-v2.md`.
- Also save a copy of the full brief as `brief.md`.

**Anywhere else** (claude.ai, phone, Claude Code outside a Jérôme project): show the brief in a single markdown block, so the user can copy it. They import it on their computer with `jerome new <name> --from-file <file>`, or `--from-file -` to read it from the clipboard through standard input.

Then reply in 2–3 lines: where the brief is, how many decisions and open questions it contains, and how to pick it up again.

## Import and conversion (Claude Code only)

`jerome new <name> --from-file` imports a valid brief/v2 or brief/v1 by itself, without you. You are needed in two cases.

**The user gives you a brief** (a file or pasted text) inside a Jérôme project:
1. Check the `format` field. `brief/v2` is imported as is. `brief/v1` is accepted: map its section headings with the table in `references/brief-v2.md`. With any other declared format, stop and report the version.
2. Sort the sections into the files as described under "Import" in `references/brief-v2.md`, and confirm in one line.

**PROJECT.md is provisional** (the CLI could not read `brief.md` as a valid brief and left an instruction to convert it):
1. Read `brief.md`, the original text, and extract goal, context, constraints, decisions, open questions and the rest, following the format.
2. The text may come from another chat and contain proposals the user never confirmed. List every decision you found and ask the user to confirm them in one block, or to say which ones to drop. Unconfirmed ones go under Open questions.
3. Write PROJECT.md, scope.md, decisions.md and open.md as described under "Import", replacing the provisional PROJECT.md. Leave `brief.md` as it is.

In both cases, propose the team of agents only afterwards, as a separate step for the user to approve.
