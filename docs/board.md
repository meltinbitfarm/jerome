# A project's board

Each project has a board (D177): what it does now and who works on it, what is left to do, what was done. The project's own viewer ([`jerome view`](commands/view.md)) shows it at the top, and the Director's [dashboard](director.md) shows it under each project, closed until you open it.

## What it holds

| Part | From |
|---|---|
| **Now** | the heartbeat running: the triage's task and each subagent at work, with what the lead agent asked of it (read from the run's transcripts, as the [live view](commands/view.md#a-run-in-progress) does) |
| **To do** | the items of `.jerome/open.md`, except the assumptions, the decision requests (the database holds them) and the parked ideas; the backlog apart, as work for when time is spare |
| **Done lately** | the last 15 lines of `.jerome/digest.md`, one per heartbeat, newest first |
| **Items closed** | the closed items of `.jerome/archive.md`, newest first by the date each one names |
| **Ideas parked** | the parked section of `open.md`: not to do for now |

The last work shown next to each project on the dashboard comes from the board too, when it has it.

## Plain words

The state files are written for the lead agent: short, in English, with file names and IDs. The board shows each text rewritten for you, in your language, in one short sentence of at most 25 words, without file names, commands, code or IDs: the ID stays beside it as a small tag. It reads as a checklist: ☐ for what is left, ✓ for what was done, the first eight shown and the rest a tap away.

- **Who rewrites it:** a call on Haiku with no tools, which gets the texts as data and is told never to follow them. It runs apart from the watchdog, so the watchdog never waits for it, a batch of 25 texts at a time.
- **When:** the first time a text is seen, by the watchdog every minute or by the viewer when it is open. Until then the item is left out, never shown in the project's own words: a line under the board counts the texts still being rewritten.
- **Kept:** in `~/.cache/jerome/plain/<language>.json` on the Mac, by the text's hash: each text is rewritten once. The newest 4000 are kept.
- **Cost:** a few thousand Haiku tokens for a project's first board, then only the new items and runs.

## The legend

Under the board, the legend says what the IDs mean:

| ID | Meaning |
|---|---|
| D | a **decision** you made or confirmed: it holds until you change it |
| O | an **open item**: a piece of work to do |
| A | an **assumption**: a choice Jérôme made on its own; you can overturn it |
| R | a **request**: a question for you to answer |
| Q | an **open question** from the brief |
| P | a **parked idea**: not to do for now |

and the words the pages use: run, turn, fill run, pace, reserve, milestone, backlog.
