# brief/v2 format

A single markdown document, written to be read by the model with few tokens.

## Rules

- Front matter keys, section headings and ID prefixes are fixed and in English, so tools can parse every brief. The content is in the user's language.
- One line per entry. No paragraphs, except Goal (at most 3 lines).
- Short, stable IDs by prefix: V constraints, D decisions, Q open questions, P parked, L limits. Agents and logs cite "see D4" instead of repeating the text. Never renumber: superseded entries stay and are marked as superseded.
- Every decision has its reason: `D3: decision — reason`. Without the reason, the choice gets questioned again later.
- Only what the user said or explicitly confirmed; silence is not confirmation. Whatever is missing goes under Open questions.
- Sections marked (optional) are left out when empty. The others always stay, even with "none".

## Template

```markdown
---
format: brief/v2
name: Readable name
slug: project-name
status: draft        # draft | ready
created: YYYY-MM-DD
source: mobile       # mobile | pc
---

## Goal
At most 3 lines: what must exist at the end, and for whom.

## Context
- Only what the lead agent cannot work out on its own.

## Constraints
- V1: ...

## Decisions
- D1: decision — reason

## Agent limits
- L1: No sending, publishing, deploying, merging to main, purchases or emails: drafts and proposals only (default).

## Tools (optional)
- MCP servers, services, requirements on the machine.

## Pace and usage (optional)
- Urgency, heartbeat frequency, quota priority compared with other projects.

## Open questions
- Q1: ...

## Parked
- P1: topic — when to talk about it again

## Out of scope
- ...

## Success
- How we know it works.
```

## Import

When a brief is imported into a Jérôme project:

| Brief sections | Project file |
|---|---|
| Goal, Context, Constraints, Agent limits, Tools, Pace and usage, Out of scope, Success | `PROJECT.md`, under `# <name>` |
| Decisions | `decisions.md`, under `# Decisions` |
| Open questions, Parked | `open.md`, under `# Open` |

The original brief stays in `brief.md` for reference. From then on, the living source is the three project files, not the brief.

## Reading brief/v1

brief/v1 had the same structure with Italian section headings. Map them like this:

| brief/v1 | brief/v2 |
|---|---|
| Obiettivo | Goal |
| Contesto | Context |
| Vincoli | Constraints |
| Decisioni | Decisions |
| Limiti agenti | Agent limits |
| Strumenti | Tools |
| Ritmo e consumi | Pace and usage |
| Domande aperte | Open questions |
| Parcheggiate | Parked |
| Fuori scope | Out of scope |
| Successo | Success |
