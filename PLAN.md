# Jérôme development plan

Based on PROJECT.md and decisions.md (D1–D27). Each phase has a result Fabio can try by hand and a definition of "done". The next phase starts only when the previous one is done.
Per D24, every phase's "done" also includes up-to-date English documentation (README.md and docs/), even where the phase does not say so.
Per D77, it also includes an up-to-date list of what Jérôme depends on in Claude Code, in `src/deps.js` (`jerome deps --json`): every field, flag, file or behaviour the phase starts using, with its decisions. `test/deps.test.js` fails when the code reads a field the list lacks.

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
**Status: done (2026-10-14).** Note in .jerome/notes/usage-probe.md, decision D20. It also turned out that:
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

The template's CLAUDE.md defines the lead agent. It is loaded into every session and every heartbeat, so it has a budget of **600 tokens** (650 since D37); PROJECT.md, which it imports, has a target of about **800 tokens**. `jerome doctor` warns, without blocking, when either is over budget, using the per-file counts of `/context`.
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
**Status: done (2026-10-15).** Fabio tested it: `jerome update` on claude-watch, a briefing with `jerome prompt` imported at zero tokens, and a free-text brief converted well by the lead agent (assumptions kept apart from facts, its own proposals left as open questions).
- `jerome new --from-file`, `jerome prompt`, `jerome update`, the JSON `.jerome` and the two new `doctor` warnings (`provisional-project`, `template`); 53 tests with `npm test`.
- Tried for real: Jérôme's own brief (brief/v1) piped from the clipboard is imported with no warnings (PROJECT.md 653 tokens, CLAUDE.md 569); the repo's `brief.md`, with its English note before the first section, is imported too, with a warning that the note was left out; `jerome update --check` on claude-watch, created before D30, lists CLAUDE.md and the skill as changed in the project, the new briefing.md, and the old MementoVault adapter as no longer in the template.
- Fixed along the way: Claude Code leaves the "Memory Files" section out of `/context` when a folder has no CLAUDE.md, and `doctor` took that for a format change. A missing section now counts as empty, while a renamed one is still an error.
- `doctor` skips the template check in Jérôme's own repository, and `jerome update` refuses to run there.
- Fabio's briefing with `jerome prompt` on a real project (prova-brief) was imported at zero tokens, but PROJECT.md was 1,600 tokens. D36 splits it: PROJECT.md keeps Goal, Constraints and Agent limits, `scope.md` (read on demand) the rest; CLAUDE.md now 604 tokens (budget 650). D37 makes budgets adjustable per project in `.jerome`. Reimported prova-brief: PROJECT.md 617 tokens, startup 12.7k → 11.7k. Migrated claude-watch: `jerome update`, then the sections moved unchanged, PROJECT.md 933 → 244 tokens, no warnings. Jérôme's own PROJECT.md split the same way.
- Two fixes after the tests:
  - in the free-text test, the lead agent answered an unrelated question before proposing the conversion. The provisional PROJECT.md now says: acknowledge any other request in one line, don't answer it, start it or run tools for it, and start the conversion. Retested headless with "Che differenza c'è tra let e const in JavaScript?" and "Inizia a costruire il sito": both replies open with a one-line acknowledgment ("Ti rispondo subito dopo", "Ci arrivo subito dopo"), go straight to the project-brief skill and brief.md, and end listing the decisions for confirmation, with nothing answered and no file written (about 46k input tokens per run, mostly cached);
  - the MANIFEST is no longer copied into projects, and `jerome update` removes the root copy where it is unchanged (D38): done on claude-watch and prova-brief.
- Success 2 (redoing the briefing on Jérôme's original idea) was not run; Fabio closed the phase on the tests above.

## Phase 4 — Rules for creating subagents

After the brief, the lead agent proposes the team with the project-team skill and creates it only after Fabio approves (D42). It starts from the catalog inside the skill (D40). For each agent:
- a model suited to the kind of work: Opus for code and writing that stays, Sonnet for research and analysis, Haiku for mechanical work and the documentation agent (D39);
- input as file paths and output in at most 150 words, with the details written to files (D4, D41);
- subagents only, never Agent Teams (D3);
- if something relevant changes, one line appended to `docs/_pending.md` (D25);
- `omitClaudeMd: true`, so it does not load the lead agent's CLAUDE.md and PROJECT.md (D27), and the project's Agent limits copied into its file, kept in sync when they change (D45).

CLAUDE.md's delegation rule points to the project's agents in `.claude/agents/`, within its budget (650, then 680 with D49; D37, D44). The default limits become binding through deny rules in the project's `.claude/settings.json` (D46).
**Service calls.** When the CLI launches `claude -p` for a task that is not the lead agent's, such as `jerome docs`, it starts from a service folder outside the project, with `--no-session-persistence`, `--settings` pointing to the project's `.claude/settings.local.json`, and `--add-dir` for the project when the task needs its files. This way the call does not load the lead agent's CLAUDE.md, leaves no transcript that would skew the usage figures, and runs with the lean profile. Checked on a test project: from a folder outside the project, without `--settings`, the call loads the user's plugins, skills and connectors (14.1k); with `--settings` it is 10.4k, with no CLAUDE.md, skills or MCP; with `--add-dir` CLAUDE.md stays out and only the project's skills come in. Claude Code creates an empty `memory` folder in `~/.claude/projects/` for every folder it starts from, so the service folder is one fixed path per project (for example under `~/.cache/jerome/`), emptied before each call, not a new temporary folder each time.

The catalog includes the documentation agent on Haiku (D25). It is launched with `/docs` in a session or `jerome docs` headless, and integrates the queue into the project's documentation (D43). `jerome doctor` warns when the queue exceeds 20 lines.
**Testable result:** on a test project the lead agent proposes a team, Fabio approves it, and a subagent runs a task. The lead agent receives a few lines of summary, the details are in files and the queue has one more line. After `jerome docs`, the documentation contains the change and the queue is empty.
**Done when:** the agents created have their model declared, none uses the large model without reason, the returned summary stays within a limit set in the rules, the documentation agent runs on Haiku, and `doctor` warns above 20 lines without blocking.
**Questions to settle first:** none.
**Status: done (2026-10-15).** Fabio checked it in an interactive session on claude-watch: delegation to the project's agents, the documentarist, and the merge of a task's branch.
- The project-team skill with the catalog (developer, writer, researcher, analyst, clerk, documentarist), the `/docs` skill, `jerome docs`, the deny rules written by `jerome doctor`, and the `limits` check and `agents`/`docs-queue` warnings of `doctor`; 64 tests with `npm test`. CLAUDE.md 635 tokens (budget 650); startup context of a new project 11.2k.
- Deny rules tested on Claude Code 2.1.300: they block the main session, built-in and custom subagents, headless runs, compound commands and env prefixes, even with `--dangerously-skip-permissions`; `git -C . push` needed its own rule (D46).
- claude-watch: `jerome update` and `doctor` added the two skills and 28 deny rules. "proponi il team di agenti dal brief" → developer (opus), analyst (sonnet), documentarist (haiku), with the other three left out for a reason each, and a decision request. After confirmation the lead agent copied L1 into each agent and recorded the team (claude-watch D25) only once the files existed. Claude Code protects `.claude/`, so headless writes there needed `--dangerously-skip-permissions`; in a session the user approves each file. The agents were listed in the next session.
- The developer implemented claude-watch's D9 with 4 tests and queued one line; the analyst reviewed it. Replies first ran to 190–250 words, with the lead agent asking for 8 lines and details in /tmp: the rules now say 150 words, no nested lists, details in `notes/`, and the lead agent must not ask for more. With the final wording (150 words, confirmed by Fabio), a Sonnet review replied in 137 words with details in `notes/`; the developer (Opus), rerun on a small fix with the lead agent itself asking for 150 words, replied in 175 words with a nested list, still over the limit. The rule alone does not hold for every agent: phase 6 hooks should measure each reply's length per agent.
- `jerome docs` on claude-watch: the project's documentarist (haiku) created `docs/version-check.md` in 23 seconds and emptied the queue.

## Phase 5 — The project database

One SQLite database per project, `.jerome.db`, kept out of git, and no global database: the account data (latest subscription %, global limits) lives in `~/.config/jerome/account.json` (D51, D52). Schema v1 holds only what phases 6-9 need: runs, usage per call, daily sums, transcript offsets, hook events and decision requests (D53). Numbered migrations in the package, schema version in `user_version`, WAL, node:sqlite with its experimental warning dropped (D54). A retention policy keeps it small (D55). Only the CLI and the hooks write it (D56); the lead agent reads it with `jerome state` (D57).
**Testable result:** a new project has the DB created by `jerome new`. Adding a migration and applying it with the CLI keeps the existing data. The .db file does not show up in git.
**Done when:** the three tests pass, and `jerome state` shows a real project's usage.
**Questions to settle first:** none (Q4 closed by D58).
**Status: done (2026-10-15).**
- `migrations/001-init.sql`, `src/db.js` (migrations, retention), `src/usage.js` (transcript reader with offsets), `src/account.js`, `src/models.js` (API list prices of 2026-10-15), `jerome state`, and the `db` check of `doctor`; 75 tests with `npm test`.
- claude-watch: `doctor` created the DB and added `.jerome.db*` to `.gitignore`. Its 13 existing transcripts, loaded with the reader the hooks will use, gave 134 calls and 4,310,921 tokens, exactly as an independent count. The first load was 7k tokens short: a response's lines repeat the `requestId` with a growing `output_tokens`, so each field now keeps its largest value (D53).
- Asked "Quanto abbiamo consumato finora su questo progetto?", the lead agent ran `jerome state` and answered "circa 4,3M token, pari a circa 3,21 $ a prezzi API". Its first try chained `jerome state` with `head` and `--help`, which the permissions refused; it then ran `jerome state` alone.

## Phase 6 — Tracking with hooks

The template configures Claude Code's hooks to call `jerome hook <event>` (D19), which writes events, runs and token usage per agent to the project DB with the transcript reader of phase 5 (D53), and prunes old rows at `SessionStart` (D55). The model reads them with `jerome state` (D57). Hooks never fail a session (D56). The model spends no tokens writing logs.
The project's versioned `.claude/settings.json`, owned by the template, also configures the status line, which calls `jerome statusline` (D23). The command stores the % of the subscription windows in `account.json`, but only if it changed since the last reading (D52). It does not replace the personal status line: if one is configured, it calls it with the same input and appends its own part. With heartbeats storing the % from the `rate_limit_event` (D20), interactive sessions become the second source.
**Testable result:**
- after a session with a subagent, a script shows the events and tokens per agent and per run, and the figures roughly match what Claude Code reports;
- after an interactive session, `account.json` has a new % reading only if the value changed;
- with a personal status line configured, Jérôme projects show both the personal line and Jérôme's part.
Two more uses of the hooks:
- a `PreToolUse` hook refuses Bash commands that chain operations changing the repository (`git commit … && git merge …`), as a second protection behind the CLAUDE.md rule (D49);
- the length of each subagent's reply is measured per agent, since the 150-word limit (D41) is exceeded by Opus agents at times.
**Done when:** every run and every subagent leaves a log line (D13, first level), and tracking requires no tool call from the model.
**Questions to settle first:** none.
**Status: done (2026-10-15).**
- `jerome hook <event>` on SessionStart, SubagentStop and Stop (async), SessionEnd and PreToolUse (D59), `jerome statusline` (D60), the chained-command check (D61), reply lengths with `jerome state --replies` (D62), run kinds and the `service` run of `jerome docs` (D63); `doctor` writes the hooks and the status line and checks them (`hooks`); 87 tests with `npm test`.
- Interactive session on claude-watch, driven in tmux: the analyst counted lines in the background, `git branch x && git branch -d x` was refused with the D49 reason and nothing ran, and the status line showed `5h 32% · 7d 20% · today ≈$2.41 API`, with the windows written once to `account.json`. After `/exit`: run closed with `prompt_input_exit`, usage 3 + 2 calls, 95,783 + 10,161 tokens, exactly as an independent count of the transcripts. Hooks took 18-24 ms each.
- `claude -p` run on claude-watch: the async Stop was cancelled at teardown, SessionEnd read the 3 calls left, and the totals matched again (28,505 + 9,092 tokens).
- Found along the way: a background subagent replies through `SubagentHandback`, so `last_assistant_message` is empty and the reply length is read from the transcript (D62); a subagent transcript without its meta file keeps the name SubagentStop recorded; `doctor`'s own `/context` call was recorded as an empty run, so Jérôme's checks now run with `JEROME_HOOKS=off`.

## Phase 7 — Read-only viewer

Local viewer separate from execution (D11): `jerome view` starts a local server with `node:http`, reachable only from localhost with a per-run token, and serves one page in plain HTML and JavaScript, with no framework or dependency (D64). It never writes anything (D65), and reads the same data as `jerome state --json` (D66): the team of the lead agent and its subagents, the runs with status, duration and usage, usage per agent and model with the cost as an API equivalent, the subscription % with its reading time and global thresholds (D70), the open decision requests and the reply lengths. Opening a run reads the tasks and replies between agents from the transcripts at that moment, without copying them (D67). Light refresh (D68), light and dark theme (D69).
**Testable result:** Fabio opens the viewer on a project with a few runs and sees the agents and their usage. Shutting the viewer down during a run, the run carries on without errors.
**Done when:** the viewer only reads from the DB and the files, never writes, and starts with `jerome view`.
**Questions to settle first:** none (Q5 closed by D64).
**Status: done (2026-10-15).**
- `jerome view`, `viewer/index.html`, `src/view.js`, `src/delegations.js`, and `readState` extended within `jerome.state/v1`; 93 tests with `npm test`, including access (no token, another host, POST), the 304, the delegations read from transcripts, and the database unchanged byte for byte.
- claude-watch: the API returned the team (lead agent on Opus 5.5, analyst on Sonnet, developer on Opus, documentarist on Haiku), 10 runs, and for the interactive run of phase 6 the background delegation to the analyst with its task and reply, and the refused `git branch + git branch` chain; a request without the token got 403; the database was unchanged. Screenshots in Chrome headless, dark and light theme and in a 390-pixel frame: the page fits, tables scroll inside their panels, and with test thresholds `5h 32% / 35%` showed red and `7d 20% / 70%` green. The server stopped cleanly on SIGTERM.
- Not tested: shutting the viewer down while a run is in progress. The viewer shares nothing with runs but read access to the database, which in WAL mode lets readers and writers work at the same time.

## Phase 8 — Heartbeat

A scheduler launches headless `claude -p` with preconfigured permissions, an overlap lock and a budget per run (D6). Before every run it goes through `jerome doctor` (D21): if the profile has grown, it brings it back to lean and logs it. If it cannot, the run does not start, the block is logged and a "decision request" is opened (D13). The lead agent produces a periodic digest (D13, second level).

**Service calls.** Runs that are not the lead agent's own work (for example the documentation agent, or a check run by the scheduler) follow the service-call rule of phase 4: service folder outside the project, `--no-session-persistence`, `--settings` with the project's local settings, `--add-dir` only if needed. Heartbeats themselves are the lead agent's work: they run in the project folder and keep their transcript, which is where their usage is read from (D20).

**Decision requests without a reader.** In a heartbeat nobody reads the reply, so a decision request in the final message would be lost. The heartbeat prompt (not CLAUDE.md, which has no room for it) tells the lead agent to write decision requests to a file or to the DB, where the viewer and the notifications pick them up, and to stop that line of work until the user answers. The same holds for merges (D47): in a heartbeat the lead agent merges a task's branch when tests pass with no conflicts, and turns failing tests or a conflict into a decision request instead of asking; the phase's tests must cover both cases, and any other confirmation the lead agent would ask for in a session.

**Trust.** Claude Code ignores a project's allow rules until the user has accepted the trust dialog in that folder (D48). The scheduler checks it, like `jerome doctor`, and does not start heartbeats on an untrusted project: without the allow rules, merges and test runs would be refused or left to the classifier.

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
**Questions to settle first:** none (Q3 closed by D71).
**Status: done (2026-10-15).** Verified for real: the scheduled runs, the lock, the decision requests and the triage. Covered by tests only: the token and turn caps, and a merge refused for failing tests (see Before the public release).
- `jerome schedule` (launchd, D71, D72), `jerome heartbeat` (D73), `jerome request` and the SessionStart context for open requests (D74), `jerome digest` (D75), the `heartbeat` check of `doctor`; the viewer fixes (D76); 104 tests with `npm test`, among them every check, both caps, the lock and the requests, with a fake `claude` and `launchctl`.
- On claude-watch, for real: a dirty tree blocked in 0.2 s with a request; after a commit, the triage chose a task and the lead agent (164,000 tokens, one minute) found it depended on open question Q1, wrote its notes on a branch, opened a decision request instead of deciding, merged, added its digest line and ended on main; a concurrent heartbeat stopped on the lock; the next found no work because of the open request; the one after stopped at zero tokens. A 15% test threshold blocked. An untrusted copy opened its request. launchd started the job twice with the nvm paths: the first was blocked because `jerome schedule` had changed `.jerome`, now ignored by the clean-tree check; the second ran the triage. A broken `node` path in the job was reported by doctor with the command to reschedule.
- Not tried for real: the token and turn caps and a merge refused for failing tests, since claude-watch had no task needing them; the fake `claude` covers them. The schedule was removed after the test; Fabio then scheduled claude-watch every day at 9:00.

## Phase 9 — Limits, pause and subscription %

Daily and weekly limits per project and global; the global ones are in % of the 5-hour and 7-day windows (D20), read from `account.json` with the thresholds stored there (D52); the per-project ones are in `.jerome` and checked against `usage` and `usage_daily`. Above a limit, heartbeats pause automatically (V4, D12). The viewer shows the subscription % read from Claude Code (D20).
**Testable result:**
- with a low project limit, the next heartbeat does not start and the paused state is visible;
- with a low global limit, the pause applies to two different projects;
- the viewer shows the % and the date of the latest reading.

**Done when:** the tests pass, the pause is lifted explicitly, and per-project usage is visible and under control (Success 3).
**Questions to settle first:** none (Q2 closed by D82).
**Status: done (2026-10-15).** The pause is lifted by the window's reset rather than explicitly (D84): no state to clear, and `jerome limits` raises or removes a limit at once.
- `jerome limits` (D83), project limits in API-equivalent dollars per calendar day and week (D82), the pause in heartbeats with one notification (D84, D85), the warning at session start and the coloured status line (D84), `projectLimits` in state and in the viewer (D86); 118 tests with `npm test`, among them the calendar windows across midnight and Monday and a global limit pausing two projects.
- Global limits set to 70% (5 hours) and 75% (7 days).
- On claude-watch with a $0.10 daily limit: two heartbeats paused with the reason, one notification; `jerome state` showed `paused`; an interactive session started with the warning and replied normally; the status line showed the 5-hour window in yellow (57% of 70%), the 7-day one in green and the day in bold red; the viewer showed the day's limit in red. Back at the default, the next heartbeat went through and did real work (433,000 tokens): the hook payload rupture check reading `jerome deps`, merged with its tests. A 50% global limit paused claude-watch's heartbeat too; the second project of the test exists only in the test suite, since no other trusted project was at hand.
- Found along the way: Haiku's two price tiers were applied to summed calls, which gave different amounts depending on the grouping ($3.35 and $3.39 for the same day); the tier is now decided per call.

## After phase 9 — Project layout

Jérôme's state moves into `.jerome/` and the lead agent's instructions into `.claude/rules/jerome.md` (D87), so a project's root stays its own; `jerome init` adopts an existing project without overwriting anything (D88); `jerome update` moves older projects once (D89).
**Status: done (2026-10-15).** 131 tests with `npm test`, among them `init` on a project with its own CLAUDE.md, settings, skill and docs, and the move of an old project with its git history, database, agents and a changed CLAUDE.md. claude-watch moved on a branch and merged: same call cost once committed, its tests pass. Jérôme's own repository moved in a separate commit (D91). The database move was then made safe against branch switches (D92), and the database moved out of the working tree, one per clone, with relinking of moved projects (D93).

## Phase 10 — Areas and milestones

A project is a product or an initiative, not a codebase (D94): its fronts of work are areas in `.jerome/areas.md` (D95), each going through milestones with success criteria (D96). The triage chooses among the areas by pace and priority (D100); usage is counted per area (D101) and shown in `jerome state` and the viewer (D102). The briefing gains a mode to add an area or open the next milestone (D97), the brief becomes brief/v3 (D98), project-team proposes the team area by area (D104), `jerome.md` stays within its budget (D103).
**Done when:** the tests pass; a project with two areas runs heartbeats in both by priority and pace, opens a milestone request and records its answer; existing projects without `areas.md` work as before; `docs/guide.md` explains the use from the idea to the next milestone, with the example of a web app that opens a marketing area after its MVP, and the README links it from "How it works".
**Questions to settle first:** none. Parked: limits per area (P4), the area briefing from claude.ai (P5).
**Status: in place and tested (2026-10-16), to try on a real project.** `.jerome/areas.md` read at zero tokens (src/areas.js), migration 002 (`runs.area`, `requests.area`), the triage among the areas due with its choice checked (D100), usage per area (D101) in `jerome state` and the viewer (D102), brief/v3 with the import of its areas and one area `main` from brief/v2 and v1 (D98), the area briefing in project-brief (D97), project-team area by area (D104), `jerome.md` at 679 tokens of 680 measured with /context (D103), doctor's `areas` warnings; with them, reset windows are no longer shown as current and the triage records the windows of its stream (D105). 134 tests with `npm test`, among them three areas with paces, a pause and a request that holds its area. The new triage prompt answered with a valid area on real Haiku (about 4,500 tokens). `docs/guide.md` and `docs/areas.md` written, the README has "How it works".
- Still to do for real: two areas on a real project, with heartbeats in both, a milestone request and its answer recorded.
- First useful result of claude-watch's research area (2026-10-16): the hooks page lists SessionStart sources `clear` and `fork` besides those Jérôme declared; checked in `src/hooks.js`, both already open a run of their own and get the open requests, and a fork's copied calls are counted once, now covered by a test and declared in `jerome deps`.

## Before the public release

Checks to do before announcing Jérôme or publishing it on npm:
- installing from GitHub and running `jerome new` on a clean machine (a new macOS user or a virtual machine), without the plugins, skills or connectors of Fabio's account;
- README and docs/ aligned with all closed phases (D24);
- no personal data in the versioned files or in the git history.
- a real heartbeat stopped by its caps, for example with a low `--max-tokens` on claude-watch, and a merge refused for failing tests (phase 8 covers them with tests only).

## Open questions by phase

| Question | To settle before phase |
|---|---|
| Q5 (CLI part) | resolved by D19 |
| Q4 | closed by D58 |
| Q5 (viewer part) | closed by D64 |
| Q3 | closed by D71 |
| Q2 | closed by D82 |

P1 and P2 (parked) and the Out of scope section of PROJECT.md stay outside the plan.
