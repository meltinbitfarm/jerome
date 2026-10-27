# `jerome doctor [dir] [--check] [--json] [--yes | --relink <key> | --new-db]`

Checks the setup and restores the lean profile of a Jérôme project. `dir` defaults to the current directory and must contain `.jerome/project.json`; for a project from before `.jerome/`, it says to run `jerome update`.

```sh
cd my-project
jerome doctor                  # check and fix
jerome doctor --check          # check only: report what needs fixing, write nothing
jerome doctor --check --json   # what external tools should run, see below
```

| Option | Effect |
|---|---|
| `--check` | Runs every check but writes nothing: no profile, no `.gitignore`, no `settings.json`. Fixes that would be applied, including missing permission rules, are reported as needed, and make the result fail. |
| `--json` | Prints a machine-readable report instead of the human output. Can be combined with `--check`. |
| `--yes` | Relinks the database of a project that moved without asking, only when there is one candidate. |
| `--relink <key>` | Relinks that database, chosen among the candidates `doctor` lists. |
| `--new-db` | Starts an empty database instead of relinking one. |

Run it whenever you install a plugin, sync new skills from claude.ai, or move the project to another machine. Scheduled runs will call it before every run.

## What it does

1. **Looks at the project's own files**, before anything else. All findings are warnings:
   - `PROJECT.md` is still provisional: the project was created from a text that is not a valid brief, and the lead agent has not converted it yet (see [new.md](new.md#importing-a-brief));
   - `PROJECT.md` still holds sections that belong in `scope.md` (Context, Out of scope, Success, Tools, Pace and usage), from before that file existed; the warning says how to migrate (see [lead-agent.md](../lead-agent.md#projects-from-before-scopemd));
   - an agent in `.claude/agents/` has no declared model (or `inherit`), or does not set `omitClaudeMd: true` (see [agents.md](../agents.md));
   - `.jerome/areas.md` has a malformed line, lists an agent with no file in `.claude/agents/` or a folder that does not exist yet, or gives an area a pace more frequent than the project's heartbeats (see [areas.md](../areas.md));
   - the documentation queue, `.jerome/docs-queue.md`, holds more than 20 entries: run [`jerome docs`](docs.md) or `/docs`;
   - template files are behind the installed Jérôme version: run [`jerome update`](update.md) to see the changes. This check is skipped in Jérôme's own repository, which holds the template in `template/` rather than a copy: a warning that is always expected would only teach you to ignore warnings.
2. **Makes the default limits binding**: adds to `.claude/settings.json` the permission rules that are missing, keeping every other setting and rule: deny for pushing, publishing, deploying and sending email, allow for the safe local git operations and the tests, ask for the forms that discard work (see [agents.md](../agents.md#binding-limits)). It also warns when Claude Code has not been told to trust the folder, since until then the allow rules are ignored. With `--check` a missing rule fails the `limits` check. Skipped in Jérôme's own repository.
3. **Adds the hooks and the status line** that record usage and refuse chained repo-changing commands, next to the project's own (see [hooks.md](../hooks.md)). A status line already set by the project is never replaced: `doctor` warns instead. With `--check` a missing hook fails the `hooks` check. Skipped in Jérôme's own repository.
4. **Checks the heartbeat job**, if the project has a schedule in `.jerome/project.json` (see [heartbeat.md](../heartbeat.md)): the launchd job must exist and be loaded, and the `node`, `jerome` and `claude` it runs must still be where they were, for example after switching Node version with nvm. Otherwise the `heartbeat` check fails and gives the command to reschedule.
5. **Creates or migrates the project database**, outside the working tree, and keeps `.jerome/jerome.db*` in `.gitignore` (see [database.md](../database.md#where-it-lives)). With `--check` it only reads the schema version from the file header, without opening the database, and fails if the database is missing, behind, newer than this Jérôme, or still in `.jerome/` (run `jerome update`).
   - If it is missing and databases of the same repository were left by folders that no longer hold the project, the project may have moved: `doctor` shows them with their runs and asks which to relink, in a terminal. `--yes` relinks the only one; with more, choose with `--relink <key>`. Until then nothing is created and the check fails.
   - Databases whose folder no longer holds a Jérôme project are reported in an `orphan-databases` warning: never deleted, [`jerome forget`](forget.md) removes one.
6. **Runs the same setup checks as `jerome new`**: Node.js, git, Claude Code and subscription login.
7. **Rebuilds the lean profile from what is installed now.**
   - It reads the installed plugins from `claude plugin list --json`.
   - It reads the skills synced from claude.ai from the Claude Code config folder.
   - It writes the result into the project's `.claude/settings.local.json`, and makes sure `.gitignore` excludes that file.
   - Profile entries left in `.claude/settings.json` by earlier versions are moved to the local file.
8. **Verifies what Claude Code actually loads** by running `claude -p "/context"` in the project. This is a local command: it makes no API call, uses no tokens and saves no session.
   - Any skill that is not a project skill, and any MCP tool without a project `.mcp.json`, counts as a leak.
   - Leaked skills that can be turned off are added to `skillOverrides`, and the check runs once more.
9. **Reports two startup figures and checks the tools sent.** `/context`, run with `-p`, estimates the headless start; its total leaves out the "System tools (deferred)" row, which does not follow the deny rules, so that row is not added. The real figure comes from the latest session of the project, interactive or heartbeat, read from its transcript at no cost: the context its first call sent, with its date. From the same transcript `doctor` reads the tools Claude Code sent and the built-in agents it listed, and warns (`context-tools`) when a denied tool or agent is still there, or an unexpected tool with a definition over 2,000 characters appears, for example after Claude Code renamed a denied tool. A session older than the last change to `.claude/settings.json` is not checked.
10. **Shows the instructions loaded in every session.** If the project has its own `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` or other rules, `doctor` shows their tokens next to `jerome.md`'s: they are paid at every call too (`context.instructions` in `--json`).
11. **Checks the token budgets** of the files loaded into every session, using the per-file counts of the same `/context` run: `.claude/rules/jerome.md` 850 tokens and `.jerome/PROJECT.md` 800 by default, or the project's own budgets from `.jerome/project.json`. Going over prints a warning starting with `!` and does not change the exit code. See [lead-agent.md](../lead-agent.md).

## What it changes

In `.claude/settings.json`, only `permissions.deny`, `permissions.ask` and `permissions.allow`, where it adds the missing rules listed in [agents.md](../agents.md#binding-limits) after your own.

In `.claude/settings.local.json`, only these keys:

- `disableClaudeAiConnectors`
- `disableBundledSkills`
- the entries for installed plugins inside `enabledPlugins`
- the entries for synced or leaked skills inside `skillOverrides`

Everything else stays as it is: permissions, hooks, your own entries in `enabledPlugins` or `skillOverrides`, and any other setting. In `.claude/settings.json` it only removes profile entries that turn something off (`false`, `"off"`, or `true` for the two `disable…` keys), and moves them to the local file. In `.gitignore` it only adds `.claude/settings.local.json` if missing. Running it twice in a row makes no changes the second time.

See [lean-profile.md](../lean-profile.md) for what each key does.

## Progress

The `/context` check takes a few seconds. On a terminal, a line on standard error shows a spinner, the elapsed time and what is running, and disappears at the end. Nothing is drawn when standard error is not a terminal, in CI, or with `JEROME_PROGRESS=off`, so `--json` output and logs stay clean.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Setup fine, lean profile verified |
| 1 | A permission rule is missing or the database is missing or behind with `--check`, the database is newer than this Jérôme, a setup check failed, the folder is not a Jérôme project, `/context` output was not recognized, or something is still loaded that should not be |
| 2 | Wrong usage |

Warnings, such as a file over its token budget, a provisional `PROJECT.md`, an agent without a model, a long documentation queue or template files behind the installed version, never change the exit code.

## When Claude Code changes `/context`

`doctor` reads the text output of `claude -p "/context"`, which is not a documented interface and can change between Claude Code releases. In the first release, a renamed section made `doctor` read empty lists and report a false pass. The format check now fails with an explicit error, listing what it did not recognize, when any of these happens:

- the `## Context Usage` heading or the `**Tokens:**` line is missing;
- the section `Estimated usage by category` or `Skills` is missing, or `Memory Files` appears under another name (another section with its table header);
- one of those sections has a table header other than `Category | Tokens | Percentage`, `Skill | Source | Tokens` or `Type | Path | Tokens`;
- `Estimated usage by category` or `Skills` is present but empty: a Jérôme project always has at least the `project-brief` skill;
- a skill has a source label `doctor` does not know. The known labels are `Project`, `User`, `Local`, `Flag`, `Managed`, `Built-in`, `MCP`, `Memory store`, `claude.ai sync` and `Plugin (<name>)`. Overrides depend on them, so an unknown one is not guessed.

`Memory Files` may be empty, or missing altogether: Claude Code leaves it out when the folder has no `CLAUDE.md` or other memory files. If this check fails after a Claude Code update, `doctor` needs updating: please open an issue.

## `--json`

`jerome doctor --json` prints a single JSON object to standard output and nothing else. It is the stable interface for other tools, which should always call `jerome doctor --check --json`: checking a project must never change it. The exit code matches `ok`: 0 when `ok` is `true`, 1 when it is `false`, and 2 for wrong usage, in which case nothing is printed to standard output.

```json
{
  "schema": "jerome.doctor/v1",
  "ok": true,
  "jerome": "0.1.0",
  "mode": "check",
  "project": "/Users/you/my-project",
  "checks": [
    { "id": "project", "ok": true, "label": "Jérôme project", "detail": "/Users/you/my-project" },
    { "id": "limits", "ok": true, "label": "Default limits", "detail": "71 permission rules in place" },
    { "id": "hooks", "ok": true, "label": "Hooks and status line", "detail": "in place" },
    { "id": "db", "ok": true, "label": "Project database", "detail": "schema 1" },
    { "id": "node", "ok": true, "label": "Node ≥ 24", "detail": "24.13.0" },
    { "id": "git", "ok": true, "label": "git installed", "detail": "git version 2.54.0" },
    { "id": "claude-code", "ok": true, "label": "Claude Code installed", "detail": "2.1.299 (Claude Code)" },
    { "id": "login", "ok": true, "label": "Logged in with a subscription", "detail": "you@example.com" },
    { "id": "profile", "ok": true, "label": "Lean profile", "detail": "already in place" },
    { "id": "context-format", "ok": true, "label": "Claude Code /context output", "detail": "recognized" },
    { "id": "startup-context", "ok": true, "label": "Startup context", "detail": "8.8k estimated headless (/context); first call of the latest session (interactive, 15/10 15:04): 11,374 tokens; project skills: project-brief, project-team" }
  ],
  "limits": { "added": [], "missing": [] },
  "hooks": { "changes": [], "pending": [] },
  "db": { "version": 1, "latest": 1, "applied": [] },
  "profile": { "changes": [], "pending": [] },
  "context": {
    "totalTokens": 10900,
    "sections": {
      "Estimated usage by category": { "found": true, "rows": 8 },
      "Skills": { "found": true, "rows": 1 },
      "Memory Files": { "found": true, "rows": 1 }
    },
    "counts": { "categories": 8, "skills": 1, "projectSkills": 1, "memoryFiles": 2 },
    "projectSkills": ["project-brief"],
    "memoryFiles": [{ "type": "Project", "file": "jerome.md", "tokens": 678 }, { "type": "Project", "file": "PROJECT.md", "tokens": 617 }],
    "leaks": { "skills": [], "mcp": [] }
  },
  "warnings": []
}
```

| Field | Meaning |
|---|---|
| `schema` | `jerome.doctor/v1`. New fields may be added within v1; renaming or removing a field, or changing its meaning, bumps the version. |
| `ok` | `true` only if every check passed. |
| `jerome` | Version of the CLI that produced the report. |
| `mode` | `"check"` with `--check`, `"fix"` otherwise. |
| `project` | Absolute path of the folder that was checked. |
| `checks` | Checks in the order they ran. `id` is stable; `label` and `detail` are for humans and may change. Checking stops at the first failure that makes the next ones pointless, so a failed report can have fewer checks. A failed `context-format` check also has `problems`, a list of strings. |
| `limits` | `added`: the rules this run added to `.claude/settings.json`; `missing`: those missing with `--check`. Each is `{ list, rule }`, with `list` one of `deny`, `ask`, `allow`. `null` in Jérôme's own repository or outside a project. |
| `hooks` | `changes`: what this run changed in the hooks and status line; `pending`: what it would change with `--check`. `null` in Jérôme's own repository. |
| `db` | `version`: the database's schema version; `latest`: the newest this Jérôme knows; `applied`: the migrations this run applied; `path`: where it is; `relinked`: `{ key, from }` when this run relinked the database of a project that moved, otherwise `null`. `null` if the check failed before reading the version. |
| `profile` | `changes`: what this run changed in the profile; `pending`: what it would change but did not, because of `--check`. One of the two is always empty. `null` if the profile check did not run. With `--check`, a non-empty `pending` makes the `profile` check, and `ok`, false. |
| `context` | `null` if `/context` was not read. If its format was not recognized, only `sections` is present. Otherwise: `totalTokens` (estimated startup context), `sections` (`found` and `rows` for each section `doctor` depends on), `counts`, `projectSkills`, `memoryFiles` (with `file` as a base name), and `leaks` (skills and MCP tool groups that should not be loaded); `lastSession`: `sessionId`, `kind` (`interactive`, `heartbeat`, or `session` when the database has no run for it), `tokens` of its first call and `at`, or `null` before any session; `tools`: `checked`, and either `reason` when not checked, or `sent` (each `{ name, chars }`), `deniedSent`, `deniedAgents` and `unexpected`. |
| `warnings` | Things worth fixing that do not make `ok` false. Each has an `id`, a `message`, and fields specific to its `id`. `budget`: `file`, `tokens` and `budget`. `provisional-project`: no extra fields. `project-layout`: `sections`, the sections to move to `scope.md`. `budgets-config`: no extra fields, for an invalid `budgets` entry in `.jerome/project.json`. `agents`: `file` and `problems`, a list of strings. `docs-queue`: `lines`, the number of entries. `trust`: no extra fields. `statusline`: no extra fields. `orphan-databases`: `databases`, a list of `{ key, path }`. `context-tools`: `deniedSent`, `deniedAgents` and `unexpected`, as in `context.tools`. `template`: `files`, a list of `{ path, status }` where `status` is `new`, `update` (unchanged in the project, safe to replace) or `modified` (changed in the project); it is empty when the files cannot be compared, and the message says why. `project-plugins`: `plugin`, `skills` and `tokens`, for a plugin the project's `settings.json` enables, which the lean profile leaves on. |

Check `id`s in v1: `project`, `limits`, `hooks`, `heartbeat` (only with a schedule), `db`, `node`, `git`, `claude-code`, `login`, `profile`, `context-format`, `startup-context`.

Without `--check`, `doctor --json` applies fixes like the plain command: it may update the profile and `.gitignore`, and lists what it changed in `profile.changes`. With `--check`, `/context` reports what Claude Code loads with the files as they are, so `context.leaks` may list skills that a fix would turn off.
