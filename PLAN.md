# Jérôme development plan

Based on PROJECT.md and decisions.md (D1–D27). Each phase has a result Fabio can try by hand and a definition of "done". The next phase starts only when the previous one is done.
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
- Bug found later in a test: `parseContext` only checked the `## Context Usage` marker, so a renamed section gave empty lists and a false pass. `/context` is now parsed strictly: required sections, table headers and `**Tokens:**` line, missing told apart from empty, unknown skill source labels rejected; renamed section, different header and unknown label each make `doctor` fail. `jerome doctor --json` was added as the stable interface for external tools, with `--check` to verify without writing anything (D28).

## Phase 2 — The lead agent in CLAUDE.md

The template's CLAUDE.md defines the lead agent. It is loaded into every session and every heartbeat, so it has a budget of **600 tokens**; PROJECT.md, which it imports, has a target of about **800 tokens**. `jerome doctor` warns, without blocking, when either is over budget, using the per-file counts of `/context`.
- At startup only PROJECT.md is loaded, through `@PROJECT.md`: no tool call, no extra turn. decisions.md and open.md are read when needed; `archive.md` only when a cited ID is not elsewhere.
- It talks in the user's language, with at most one question per reply.
- It cites entries by ID ("see D4") and does not reopen recorded decisions unless a concrete problem appears.
- It is the only one that updates the state files (D7). It moves closed open.md entries and long-superseded decisions to `archive.md`, keeping their IDs, so the files read on demand stay light.
- It delegates to subagents only, passing file paths and asking for short summaries, on the cheapest model that fits (D3–D5). The rules are spelled out, not cited by ID: in a project, D-numbers belong to the project.
- It respects the agent limits of PROJECT.md, with L1 as the default.
- When the user is needed, it ends with a "decision request" in the user's language (D13).

**Testable result:** in a test project with the three files already filled in, Fabio opens Claude Code and asks "where are we". The lead agent answers citing the IDs. Asked to deploy, it proposes a draft and does not run it.
**Done when:** both tests pass in a new session, CLAUDE.md stays within 600 tokens, and the startup cost before and after is measured and documented.
**Questions to settle first:** none.
**Status: done (2026-10-14).** Fabio tested it with a real briefing (the claude-watch project): one question at a time, reasoned recommendations, recorded decisions not reopened, file paths instead of contents, and important token details found on its own.
- One fix after the test: the lead agent recorded four decisions it had proposed itself and the user had not confirmed ("you let them through without objections"). The rule is now stronger in CLAUDE.md and in the project-brief skill: proposals the user has not explicitly confirmed are listed for confirmation in one block before recording or saving, and silence is not confirmation. CLAUDE.md went from 496 to 536 tokens.
- `template/CLAUDE.md`, listed in the MANIFEST: 496 tokens according to `/context` before that fix. The budget was first set at 500 and then raised to 600: 4 tokens of headroom were too few for the delegation rule of phase 4, and 100 tokens are about 0.7% of a call.
- Measured on a project from `jerome new`, with Jérôme's own state files as a realistic example (PROJECT.md: 614 tokens):
  - estimated startup context: 10.4k without CLAUDE.md, 11.5k with it;
  - real cost of one call: 12,348 input tokens without, 13,735 with: **+1,387 tokens per call**;
  - a built-in subagent loads CLAUDE.md and PROJECT.md too: 2,518 tokens instead of 1,142. With `omitClaudeMd: true` it is back to 1,142 (D27).
- Both tests pass in headless sessions. "A che punto siamo?" gets an answer in Italian citing IDs, after reading open.md and decisions.md only for that question. "Pubblica adesso il pacchetto su npm" is refused under L1, with a draft and a decision request.
- A project without PROJECT.md (before the briefing) loads fine: the import of a missing file is skipped.

## Phase 3 — Briefing and import in the template

The contract is the brief/v2 format, not a tool (D34). A brief can come from anywhere:
- from the PC, the briefing with the project-brief skill in Claude Code, inside the project, writes the files right away;
- from any chat (claude.ai on the phone, ChatGPT, Gemini…), with the skill or with the instructions printed by `jerome prompt` (D34), the brief ends up in a markdown block; it reaches the Mac through the chat history or the clipboard and is imported with `jerome new <name> --from-file <path|->` (D29, D33).

The import is tolerant (D35): a valid brief/v2 or brief/v1 is sorted by the CLI into PROJECT.md, decisions.md and open.md following the "Import" table in `references/brief-v2.md`, at zero tokens; a declared but unknown format stops the command; any other text is saved in `brief.md` with a provisional PROJECT.md that tells the lead agent to convert it first, with the user's confirmation. `jerome doctor` warns while PROJECT.md is provisional.

Existing projects receive template fixes with `jerome update`, and `jerome doctor` warns when they are behind (D30). Project rules live in PROJECT.md, never in template files (D32).

**Testable result:** a briefing on the phone, copied and imported with `pbpaste | jerome new <name> --from-file -`, leads to a project with the lead agent ready (Success 1). Redoing the briefing on Jérôme's original idea leads to the same decisions (Success 2). A free-text brief is converted by the lead agent in the first session, after confirmation of the decisions.
**Done when:** both Success criteria pass; `--from-file` works from a file and from standard input, with and without code fences; an unknown format is rejected with a message and creates nothing; `jerome prompt` prints instructions that, pasted into another chat, produce a brief the CLI imports; `jerome update` brings claude-watch up to date without touching its state files; docs/ describes `prompt`, `update` and the import (D24).
**Questions to settle first:** none.
**Status: implemented (2026-10-15), waiting for the tests with Fabio.**
- `jerome new --from-file`, `jerome prompt`, `jerome update`, the JSON `.jerome` and the two new `doctor` warnings (`provisional-project`, `template`); 53 tests with `npm test`.
- Tried for real: Jérôme's own brief (brief/v1) piped from the clipboard is imported with no warnings (PROJECT.md 653 tokens, CLAUDE.md 569); the repo's `brief.md`, with its English note before the first section, is imported too, with a warning that the note was left out; `jerome update --check` on claude-watch, created before D30, lists CLAUDE.md and the skill as changed in the project, the new briefing.md, and the old MementoVault adapter as no longer in the template.
- Fixed along the way: Claude Code leaves the "Memory Files" section out of `/context` when a folder has no CLAUDE.md, and `doctor` took that for a format change. A missing section now counts as empty, while a renamed one is still an error.
- `doctor` skips the template check in Jérôme's own repository, and `jerome update` refuses to run there.
- Fabio's briefing with `jerome prompt` on a real project (prova-brief) was imported at zero tokens, but PROJECT.md was 1,600 tokens. D36 splits it: PROJECT.md keeps Goal, Constraints and Agent limits, `scope.md` (read on demand) the rest; CLAUDE.md now 604 tokens (budget 650). D37 makes budgets adjustable per project in `.jerome`. Reimported prova-brief: PROJECT.md 617 tokens, startup 12.7k → 11.7k. Migrated claude-watch: `jerome update`, then the sections moved unchanged, PROJECT.md 933 → 244 tokens, no warnings. Jérôme's own PROJECT.md split the same way.
- Still to do: Fabio applies `jerome update` to claude-watch; a briefing on the phone imported from the clipboard (Success 1); a free-text brief converted by the lead agent in the first session; Success 2.

## Phase 4 — Rules for creating subagents

After the brief, the lead agent proposes the team and creates it only after Fabio approves. It starts from the catalog in templates/agents/ (D10). For each agent:
- a model suited to the task (D5);
- input as file paths and output as a short summary, with the details written to files (D4);
- subagents only, never Agent Teams (D3);
- if something relevant changes, one line appended to `docs/_pending.md` (D25);
- `omitClaudeMd: true`, so it does not load the lead agent's CLAUDE.md and PROJECT.md (D27).

Once the catalog exists, CLAUDE.md's delegation rule should point to the project's agents in `.claude/agents/`, within its 600-token budget.
**Service calls.** When the CLI launches `claude -p` for a task that is not the lead agent's, such as `jerome docs`, it starts from a service folder outside the project, with `--no-session-persistence`, `--settings` pointing to the project's `.claude/settings.local.json`, and `--add-dir` for the project when the task needs its files. This way the call does not load the lead agent's CLAUDE.md, leaves no transcript that would skew the usage figures, and runs with the lean profile. Checked on a test project: from a folder outside the project, without `--settings`, the call loads the user's plugins, skills and connectors (14.1k); with `--settings` it is 10.4k, with no CLAUDE.md, skills or MCP; with `--add-dir` CLAUDE.md stays out and only the project's skills come in. Claude Code creates an empty `memory` folder in `~/.claude/projects/` for every folder it starts from, so the service folder is one fixed path per project (for example under `~/.cache/jerome/`), emptied before each call, not a new temporary folder each time.

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

**Service calls.** Runs that are not the lead agent's own work (for example the documentation agent, or a check run by the scheduler) follow the service-call rule of phase 4: service folder outside the project, `--no-session-persistence`, `--settings` with the project's local settings, `--add-dir` only if needed. Heartbeats themselves are the lead agent's work: they run in the project folder and keep their transcript, which is where their usage is read from (D20).

**Decision requests without a reader.** In a heartbeat nobody reads the reply, so a decision request in the final message would be lost. The heartbeat prompt (not CLAUDE.md, which has no room for it) tells the lead agent to write decision requests to a file or to the DB, where the viewer and the notifications pick them up, and to stop that line of work until the user answers.

**Provisional projects.** The scheduler never runs a heartbeat on a project whose PROJECT.md is still provisional (D35): the brief has not been converted and confirmed yet, so there is nothing safe to work on. It logs the block and opens a decision request asking the user to open a session and finish the conversion.

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
- after switching Node version with nvm (or removing the recorded path), `jerome doctor` reports the job's broken path and how to reschedule it;
- a heartbeat that needs the user leaves its decision request where the viewer shows it, and the next heartbeat does not redo that work before the answer;
- on a project with a provisional PROJECT.md, the heartbeat does not start, and the log line and the decision request appear.

**Done when:** all ten tests pass, and a heartbeat never performs actions forbidden by L1.
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
