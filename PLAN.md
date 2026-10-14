# Jérôme development plan

Based on PROJECT.md and decisions.md (D1–D26). Each phase has a result Fabio can try by hand and a definition of "done". The next phase starts only when the previous one is done.
Per D24, every phase's "done" also includes up-to-date English documentation (README.md and docs/), even where the phase does not say so.

## Phase 0 — Separate Jérôme's development from the template

**The problem.** Today the repo holds two different things:
- Jérôme's development state: PROJECT.md, decisions.md, open.md, brief.md, PLAN.md and the `.jerome` marker (Jérôme uses itself to manage its own development);
- the content that will end up in every project: the project-brief skill and, later, the lead agent's CLAUDE.md, templates/agents/ and the hook configuration.

If the template is the whole repo, D1 ("one project = one folder with the template repo cloned into it") would also bring Jérôme's decisions and plan into every project.

**Decision (D17, approved):** the template content lives in a `template/` subfolder, and `jerome new` copies it into a new folder (the template ships inside the package, D19). The whole repo is no longer cloned.
- The root holds only what is needed to develop Jérôme; `template/` holds only what must end up in projects.
- The project-brief skill has a single canonical copy, in `template/.claude/skills/`. The copy used to develop Jérôme is a link to it, so D14 (one briefing method) stays true.
- The template does not contain PROJECT.md, decisions.md and open.md: they are created in each project by the briefing or the import.
- Updates reach projects by syncing only the files owned by the template, listed in a manifest. Migrations come with them (D9). Project state files stay out.
- Rejected: two separate repos (double maintenance for a solo developer) and a dedicated template branch (fragile to keep aligned).

**D1 is refined by D17:** "cloned" becomes "created from the template". The meaning stays the same: one self-contained project per folder.

**Testable result:** the repo tree shows the development root separate from `template/`, and a folder created by copying `template/` contains none of Jérôme's development files.
**Done when:** D17 is recorded in decisions.md, the skill is moved into `template/` with the link for development, the manifest of template files exists, and docs/ explains the repository layout (development root and `template/`, D24).
**Questions to settle first:** none.

## Phase 0.5 — Quick check of the usage data

A throwaway test, outside `template/`: a minimal hook writes to a file, without interpreting it, everything it receives at each event. Then a test session where the lead agent delegates a task to a subagent.

What to check:
- which events arrive (end of response, end of subagent, tool use, end of session) and with which fields;
- whether tokens (input, output, cache) and the model are in the hook payload or only in the transcript the payload points to;
- whether the subagent's usage can be told apart from the lead agent's;
- whether there is a cost or any data useful for the subscription %;
- for heartbeats: what `claude -p` returns with JSON output.

**Testable result:** a short note with the available fields, where they are and a real example of each. Fabio reads it and sees where the viewer's numbers will come from.
**Done when:** the note exists, the source of usage data is recorded as a decision, and docs/ explains in English where the data comes from and why the lean profile exists (D24). The schema of phase 5 depends on that decision.
**Questions to settle first:** none.
**Status: done (2026-10-14).** Note in notes/usage-probe.md, decision D20. It also turned out that:
- the status line receives the subscription % too;
- the fixed startup cost drops from ~29k to ~12k tokens by turning off unused plugins, claude.ai connectors and skills per project.

## Phase 1 — "New project" command and setup check

The package is installed with `npm i -g github:meltinbitfarm/jerome` (D19). `jerome new <name>`:
- creates the folder from the template;
- initializes git;
- creates the `.jerome` marker;
- checks Node ≥ 24, Claude Code installed and subscription login (V3);
- writes the lean profile into `.claude/settings.local.json` and adds that file to `.gitignore` (D21).

The `.jerome` marker must be created explicitly by `jerome new`: it is not in `template/` nor in the MANIFEST, so copying the template does not bring it along.
The same goes for `.claude/settings.local.json`: the CLI writes it, because the list of plugins to turn off depends on what is installed on the machine, and git ignores it. The CLI manages only its own keys and leaves the others alone. The versioned `.claude/settings.json` is left for machine-independent settings, such as the hooks and the status line of phase 6.
`jerome doctor` repeats the checks and rechecks the profile against what is installed at that moment.
**Testable result:**
- after installing, `jerome new prova` produces a ready folder;
- without a login, or without Claude Code, the command stops with a clear message;
- in `prova`, `claude -p "/context"` lists only project-brief (the project copy) as a skill, and a `claude -p` call stays around 12k startup tokens;
- after installing a new plugin, `jerome doctor` reports it and turns it off in the profile.

**Done when:**
- after the push, installing from GitHub on Fabio's Mac works, and `jerome new` and `jerome doctor` also work with the login missing;
- running `jerome new` again on an existing folder overwrites nothing;
- `jerome doctor` changes only the profile keys, not the others;
- CLI messages are in English, and README and docs/ explain installation, `new` and `doctor` (D24).

**Questions to settle first:** none. The CLI part of Q5 is resolved by D19.
**Status: done (2026-10-14).** Fabio installed from GitHub on his Mac and ran `jerome new prova-jerome`: all checks passed, 22 profile changes, 10.4k startup context.
- Code in `bin/` and `src/`, 17 tests with `npm test`, which use a fake `claude` and never call the real Claude Code.
- Tried with the real package (`npm pack`, installed into a temporary prefix):
  - project creation;
  - stopping without a login and without Claude Code, without creating the folder;
  - no overwrite of an existing folder;
  - `doctor` restoring the profile while leaving the other keys, with no changes on the second run.
- Measured startup: 12,384 real tokens, `/context` shows only the project's project-brief.
- The `/context` check found and turned off `plugin-authoring`, which shows up neither among the plugins nor among the synced skills.
- After the release, D21 was corrected: the profile moved to `.claude/settings.local.json`, which git ignores. `/context` shows the same result (10.4k, only project-brief), and a real call starts at 12,318 tokens. `jerome doctor` moves profile entries left in `settings.json` by earlier versions, which covers `prova-jerome`.
- The test on a clean machine has moved to the checks before the public release.

## Phase 2 — The lead agent in CLAUDE.md

The template's CLAUDE.md defines the lead agent:
- at startup it reads PROJECT.md, decisions.md and open.md, not the whole history;
- it is the only one that updates those three files (D7);
- it cites entries by ID ("see D4") instead of repeating them;
- it respects the L1 limits;
- when Fabio is needed, it ends with a "decision request" (D13).

**Testable result:** in a test project with the three files already filled in, Fabio opens Claude Code and asks "where are we". The lead agent answers citing the IDs. Asked to deploy, it proposes a draft and does not run it.
**Done when:** both tests pass in a new session, and CLAUDE.md stays short (few tokens loaded per session, V1).
**Questions to settle first:** none.

## Phase 3 — Briefing and import in the template

Both flows of D15 work inside a project created from the template:
- from the PC, the briefing with the project-brief skill in Claude Code writes the files right away;
- from the phone, the brief saved in MementoVault is imported on the PC by the CLI with `jerome new <name> --from-vault <slug>` (D22), without the model.

The CLI reads the token from `~/.config/jerome/`, downloads the `brief` document, checks `format: brief/v2` (or the older brief/v1) and sorts the sections into the three files following the "Import" table in `references/brief-v2.md` (D26). The skill's Import section points to the CLI.
**Testable result:** from a brief saved on the phone, a single command leads to a project with the lead agent ready (Success 1). Redoing the briefing on Jérôme's original idea leads to the same decisions (Success 2).
**Done when:** both Success criteria pass, and a brief in a format other than brief/v2 or brief/v1 is rejected with a message.
**Questions to settle first:** none. Still to verify which route the CLI takes (D22): MementoVault's REST endpoint, if there is one for reading a document, otherwise the MCP endpoint called over HTTP with the token.

## Phase 4 — Rules for creating subagents

After the brief, the lead agent proposes the team and creates it only after Fabio approves. It starts from the catalog in templates/agents/ (D10). For each agent:
- a model suited to the task (D5);
- input as file paths and output as a short summary, with the details written to files (D4);
- subagents only, never Agent Teams (D3);
- if something relevant changes, one line appended to `docs/_pending.md` (D25).

The catalog includes the documentation agent on Haiku (D25). It is launched with `/docs` in a session or `jerome docs` headless, and integrates the queue into the project's documentation. `jerome doctor` warns when the queue exceeds 20 lines.
**Testable result:** on a test project the lead agent proposes a team, Fabio approves it, and a subagent runs a task. The lead agent receives a few lines of summary, the details are in files and the queue has one more line. After `jerome docs`, the documentation contains the change and the queue is empty.
**Done when:** the agents created have their model declared, none uses the large model without reason, the returned summary stays within a limit set in the rules, the documentation agent runs on Haiku, and `doctor` warns above 20 lines without blocking.
**Questions to settle first:** none.

## Phase 5 — SQLite databases and migrations

Numbered SQL migrations in the package, applied by the CLI with `node:sqlite` (D19). `jerome new` creates the project DB in WAL mode and the global DB in ~/.config/jerome/ (D9, D12). The seed contains only reference data: states, event types, default budgets and the model table (D10).
**Testable result:** a new project has the DB created by `jerome new`. Adding a migration and applying it with the CLI keeps the existing data. The .db file does not show up in git.
**Done when:** all three tests pass for both the project DB and the global DB.
**Questions to settle first:**
- ~~outcome of phase 0.5~~ resolved by D20: usage per agent and per run (model, input, output, cache read and cache write) in the project DB, subscription readings in the global DB;
- Q4: if the Company → project → agents hierarchy stays, the global schema must allow for it from the start;
- Q2 and Q3 do not block, because the defaults are seed rows that can be changed later.

## Phase 6 — Tracking with hooks

The template configures Claude Code's hooks to call `jerome hook <event>` (D19), which writes events, runs and token usage per agent to the DB. The model queries them through bash (D8); this phase decides whether through scripts or a CLI command. The experimental warning of `node:sqlite` must be suppressed so it does not end up in the hooks' output. The model spends no tokens writing logs.
The project's versioned `.claude/settings.json`, owned by the template, also configures the status line, which calls `jerome statusline` (D23). The command stores the % of the subscription windows in the global DB, but only if it changed since the last reading. It does not replace the personal status line: if one is configured, it calls it with the same input and appends its own part. With heartbeats storing the % from the `rate_limit_event` (D20), interactive sessions become the second source.
**Testable result:**
- after a session with a subagent, a script shows the events and tokens per agent and per run, and the figures roughly match what Claude Code reports;
- after an interactive session, the global DB has a new % reading only if the value changed;
- with a personal status line configured, Jérôme projects show both the personal line and Jérôme's part.
**Done when:** every run and every subagent leaves a log line (D13, first level), and tracking requires no tool call from the model.
**Questions to settle first:** none. The risk around usage data was already checked in phase 0.5.

## Phase 7 — Read-only viewer

Local viewer separate from execution (D11): agent structure, messages, logs, reports, tokens and estimated cost. It also shows the latest subscription % read (D20, D23), with its date.
**Testable result:** Fabio opens the viewer on a project with a few runs and sees the agents and their usage. Shutting the viewer down during a run, the run carries on without errors.
**Done when:** the viewer only reads from the DB and the files, never writes, and starts with `jerome view`.
**Questions to settle first:**
- Q5, viewer part (interface stack; the command is `jerome view`);
- Q4 (whether the drag-and-drop graph belongs to the viewer or to a later phase).

## Phase 8 — Heartbeat

A scheduler launches headless `claude -p` with preconfigured permissions, an overlap lock and a budget per run (D6). Before every run it goes through `jerome doctor` (D21): if the profile has grown, it brings it back to lean and logs it. If it cannot, the run does not start, the block is logged and a "decision request" is opened (D13). The lead agent produces a periodic digest (D13, second level).

**Executable paths.** Jobs started by launchd or cron do not load the user's shell profile, so they do not see version managers like nvm. On Fabio's Mac, Node and jerome are installed through nvm (`~/.nvm/versions/node/v24.13.0/bin/`) and would not be found by a scheduled job. The same holds for `claude`, installed in `~/.local/bin`.
- When a heartbeat is scheduled, the CLI writes into the job the absolute paths of `node`, `jerome` and `claude` detected at that moment, or an explicit `PATH` built from them. It never relies on the PATH of the environment the job runs in.
- `jerome doctor` checks that the paths recorded in the project's jobs still exist and are executable, for example after switching Node version with nvm. If one is missing, it reports it with the command to reschedule the job.
- A heartbeat that cannot start because a path is missing leaves its log line, like any other block.

**Testable result:**
- a scheduled heartbeat runs a task and leaves its log line;
- a second heartbeat launched at the same time stops because of the lock;
- a run that exceeds its budget is stopped;
- the digest appears where expected;
- with a plugin installed after `jerome new`, the next run still starts with the lean profile;
- with a profile `doctor` cannot fix, the run does not start, and the log line and the "decision request" appear;
- a job scheduled from a shell with Node from nvm runs under launchd, with no shell profile loaded;
- after switching Node version with nvm (or removing the recorded path), `jerome doctor` reports the job's broken path and how to reschedule it.

**Done when:** all eight tests pass, and a heartbeat never performs actions forbidden by L1.
**Questions to settle first:** Q3 (default frequency and budget per run).

## Phase 9 — Limits, pause and subscription %

Daily and weekly limits per project and global; the global ones are in % of the 5-hour and 7-day windows (D20). Above a limit, heartbeats pause automatically (V4, D12). The viewer shows the subscription % read from Claude Code (D20).
**Testable result:**
- with a low project limit, the next heartbeat does not start and the paused state is visible;
- with a low global limit, the pause applies to two different projects;
- the viewer shows the % and the date of the latest reading.

**Done when:** the tests pass, the pause is lifted explicitly, and per-project usage is visible and under control (Success 3).
**Questions to settle first:** Q2, narrowed by D20 to per-project limits only.

## Before the public release

Checks to do before announcing Jérôme or publishing it on npm:
- installing from GitHub and running `jerome new` on a clean machine (a new macOS user or a virtual machine), without the plugins, skills or connectors of Fabio's account;
- README and docs/ aligned with all closed phases (D24);
- no personal data in the versioned files or in the git history.

## Open questions by phase

| Question | To settle before phase |
|---|---|
| Q5 (CLI part) | resolved by D19 |
| Q4 | 5 (schema) and 7 (viewer) |
| Q5 (viewer part) | 7 |
| Q3 | 8 |
| Q2 | 9 |

P1 and P2 (parked) and the Out of scope section of PROJECT.md stay outside the plan.
