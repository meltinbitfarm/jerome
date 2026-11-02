# Memory format

The format of a project's three memory files, as Jérôme keeps them in `.jerome/`: `open.md` (what is open now), `decisions.md` (what was decided) and `digest.md` (what was done). It is the format in use, described as Jérôme's code reads it, so other projects can keep their memory the same way and be read by the same tools. Nothing here changes how Jérôme works.

The files are Markdown, in UTF-8, committed with the project. Next to them, `archive.md` takes the entries closed or superseded, and `PROJECT.md` holds the goal, the areas and the project's rules; they are described briefly at the end.

## Rules for all three

- **One writer.** Only the lead agent, the session or heartbeat that works on the project, edits the files. Subagents and tools report; the lead records what matters. Jérôme itself never edits them: it reads them.
- **One line per entry.** An entry is a single line, however long. No wrapped lines, no nested lists, no blank lines inside a section.
- **IDs are never renumbered.** A letter and a number, per kind (`D7`, `A3`, `P1`), each kind counted on its own; a new entry takes the next number. An entry that ends keeps its ID, moved to `archive.md`, so a reference such as "see D4" always leads somewhere.
- **Dates.** In the text of an entry, `DD/MM` (or `DD/MM/YYYY` when the year is not the current one), in parentheses at the end: `(31/10)`. In `digest.md`, `YYYY-MM-DD HH:MM` at the start of the line.
- **Language.** The user's language or English, as the project does; plain words, no personality: the user reads them again later.
- **Light on purpose.** They are read on demand, so they stay short: closed entries and long-superseded decisions go to `archive.md`.

## open.md

What is open now: questions for the user, work set aside, choices made without the user, and spare work.

```markdown
# Open

## Open questions
- Which payment provider for the shop? (asked: R12)
- Do we keep the old URLs as redirects?

## Parked
- P1: Internal growth tools — bring no traffic; take up again after 16/12.

## Assumptions
- A3: Prices shown with VAT — the market is consumers (28/10).

## Backlog
- Measure the home page's load and compress the icons if they are the cause.
```

### Sections

The file starts with `# Open`. Each section is a level-2 heading, `## <name>`; an entry belongs to the last heading above it, and a line before the first heading is not an entry. The name of a section decides what it holds, matched without regard to case:

| A heading that contains | Holds | What happens to its entries |
|---|---|---|
| `Assumption` | choices the lead made alone, minor and reversible | put to the user in one block at the start of a session; confirmed or corrected, each becomes a decision and leaves the file. They hold nothing up. Read only under a heading exactly `## Assumptions`. |
| `Park` or `Idea` | topics set aside on purpose | never chosen as work. One that names when to come back (a date, "after 16/12") is asked again once that time comes. |
| `Backlog` | work that needs nobody and helps (tests, refactors, research) | taken by the runs that fill unused quota; never chosen otherwise. |
| `Question` | questions only the user can answer | each is asked as a decision request, then marked `(asked: R<n>)`; once answered, the answer becomes a decision and the question goes. |
| `Decision request` | nothing: requests live in Jérôme's database | left out. |
| anything else | work to do | chosen by the next runs, in order. |

The usual sections, in this order, are `## Open questions`, `## Parked`, `## Assumptions` and `## Backlog`; a project may add sections of work to do, named as it likes.

### Entries

```
- <text>
- <ID>: <text>
<ID>: <text>
```

- An entry is a line that starts with `- `, or with an ID followed by `: `. `<ID>` is one capital letter and digits: `A` for assumptions (`A3`), `P` for parked topics (`P1`), and any other letter a project uses for its own items (`O7`). An entry with no ID is allowed everywhere but under Assumptions.
- **An assumption** is `- A<n>: <choice> — <reason>` (an em dash between them), with the date at the end.
- **A question already asked** ends with ` (asked: R<n>)`, the number of its decision request; a question without the mark has not been asked yet.
- **Work for a session**: an entry whose text says `interactive session` (or `sessione interattiva`) is shown as waiting for the user; heartbeats do it all the same or ask for what only the user can do.

## decisions.md

What was decided, by the user or with their confirmation. It is the project's long memory: recorded decisions are settled, cited by their ID, and reopened only for a concrete problem, named.

```markdown
# Decisions

- D1: Reach 500 €/month by October 2027 — the user needs income soon (21/10).
- D2: Laravel with Inertia and React — the user already knows it (21/10).
- D7: Prices shown with VAT, confirming A3 — the market is consumers (28/10).
- D9: Stripe for payments, replacing D5 — PayPal fees too high for small amounts (30/10).
```

- The file starts with `# Decisions`, then a blank line, then one entry per line, **oldest first**: a new decision is appended at the end.
- An entry is `- D<n>: <decision> — <reason>` with ` (DD/MM)` at the end. The reason says why, in the user's words when it is their answer.
- Only decisions the user made or confirmed. Silence is not a confirmation; a choice made alone is an assumption in `open.md` until confirmed.
- **Superseded**: the entry is never edited into another decision nor deleted. The new decision says what it replaces (`replacing D5`), the old one is marked superseded (for example `(superseded by D9)` after its text), and when it is long superseded it moves to `archive.md` under `## Decisions`, with its ID.
- A project that has no decisions yet holds `none` under the title.

## digest.md

What was done, one line per piece of work. It is the project's diary: the next runs read its last lines to know where the work stands, and `jerome digest` sums them up.

```markdown
# Digest

- 2026-10-28 21:55 · traffic · Dry-run of the import on 92 towns, apply blocked until 29/10 · none merged · none
- 2026-11-02 09:30 · IMU summary checked on a local build (29/29), recipe added · agent/imu-summary merged · no requests
```

- The file starts with `# Digest`; each entry is **appended at the end**, oldest first, and never edited afterwards.
- An entry is `- YYYY-MM-DD HH:MM · <area> · <what was done> · <branches merged> · <requests opened>`, the parts separated by ` · ` (a space, a middle dot, a space). `<area> · ` is there only when the project has areas; the last two parts say `none` when there are none. A line that does not start with a date and ` · ` is not read as an entry.
- **One entry per run.** A heartbeat must add one before it ends: Jérôme counts the lines starting with `- ` before and after the run, and a run that added none fails its end check. A session adds one when it did work worth recording.
- Short: what was done and its result, not how; the details go in `notes/`.

## The files around them

- **archive.md**: `# Archive`, then `## Closed` for the items of work and questions closed, each as `- <ID>: <text> — done YYYY-MM-DD: <how>` (the boards show these as done, newest first by that date, and need the ID; any heading that contains `Closed` is read the same way), and `## Decisions` and `## Assumptions` for the entries superseded or settled, moved as they were with how they ended, e.g. `- A8 (superseded by A17, 30/10): …`.
- **notes/**: details that do not fit one line: an agent's report as `YYYY-MM-DD-<agent>-<topic>.md`, and recipes, how to do something that took effort to work out, in `notes/recipes/<topic>.md`. Entries point to them by path.
- **PROJECT.md**: the goal, the success criteria, the areas and `## Project rules`. It changes rarely, only on the user's word.

## Who reads them

| File | Read by |
|---|---|
| `open.md` | the lead agent on status questions; the heartbeat's triage, to choose the work; the boards of `jerome view` and of the Director's dashboard; the session start, for the assumptions; `jerome state`; the check of answers not recorded yet, through `(asked: R<n>)` |
| `decisions.md` | the lead agent before proposing an approach and when a decision is cited; the triage, to know whether anything changed since the last run |
| `digest.md` | the triage (its last lines); the boards (what was done); `jerome digest`; the end check of every heartbeat |
| `archive.md` | the boards (items closed); anyone looking up an ID found nowhere else |

Whoever adopts the format for a project without Jérôme keeps the same files at the same paths (`.jerome/open.md`, `.jerome/decisions.md`, `.jerome/digest.md`), or at the root under the same names: the rules above hold either way.
