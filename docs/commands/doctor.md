# `jerome doctor [dir] [--check] [--json]`

Checks the setup and restores the lean profile of a Jérôme project. `dir` defaults to the current directory and must contain the `.jerome` marker.

```sh
cd my-project
jerome doctor                  # check and fix
jerome doctor --check          # check only: report what needs fixing, write nothing
jerome doctor --check --json   # what external tools should run, see below
```

| Option | Effect |
|---|---|
| `--check` | Runs every check but writes nothing: no profile, no `.gitignore`, no `settings.json`. Fixes that would be applied are reported as needed, and make the result fail. |
| `--json` | Prints a machine-readable report instead of the human output. Can be combined with `--check`. |

Run it whenever you install a plugin, sync new skills from claude.ai, or move the project to another machine. Scheduled runs will call it before every run.

## What it does

1. **Looks at the project's own files**, before anything else. Both findings are warnings:
   - `PROJECT.md` is still provisional: the project was created from a text that is not a valid brief, and the lead agent has not converted it yet (see [new.md](new.md#importing-a-brief));
   - template files are behind the installed Jérôme version: run [`jerome update`](update.md) to see the changes. This check is skipped in Jérôme's own repository, which holds the template in `template/` rather than a copy: a warning that is always expected would only teach you to ignore warnings.
2. **Runs the same setup checks as `jerome new`**: Node.js, git, Claude Code and subscription login.
3. **Rebuilds the lean profile from what is installed now.**
   - It reads the installed plugins from `claude plugin list --json`.
   - It reads the skills synced from claude.ai from the Claude Code config folder.
   - It writes the result into the project's `.claude/settings.local.json`, and makes sure `.gitignore` excludes that file.
   - Profile entries left in `.claude/settings.json` by earlier versions are moved to the local file.
4. **Verifies what Claude Code actually loads** by running `claude -p "/context"` in the project. This is a local command: it makes no API call, uses no tokens and saves no session.
   - Any skill that is not a project skill, and any MCP tool without a project `.mcp.json`, counts as a leak.
   - Leaked skills that can be turned off are added to `skillOverrides`, and the check runs once more.
5. **Checks the token budgets** of the files loaded into every session, using the per-file counts of the same `/context` run: `CLAUDE.md` at most 600 tokens, `PROJECT.md` about 800. Going over prints a warning starting with `!` and does not change the exit code. See [lead-agent.md](../lead-agent.md).

## What it changes

Only these keys in `.claude/settings.local.json`:

- `disableClaudeAiConnectors`
- `disableBundledSkills`
- the entries for installed plugins inside `enabledPlugins`
- the entries for synced or leaked skills inside `skillOverrides`

Everything else stays as it is: permissions, hooks, your own entries in `enabledPlugins` or `skillOverrides`, and any other setting. In `.claude/settings.json` it only removes profile entries that turn something off (`false`, `"off"`, or `true` for the two `disable…` keys), and moves them to the local file. In `.gitignore` it only adds `.claude/settings.local.json` if missing. Running it twice in a row makes no changes the second time.

See [lean-profile.md](../lean-profile.md) for what each key does.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Setup fine, lean profile verified |
| 1 | A setup check failed, the folder is not a Jérôme project, `/context` output was not recognized, or something is still loaded that should not be |
| 2 | Wrong usage |

Warnings, such as a file over its token budget, a provisional `PROJECT.md` or template files behind the installed version, never change the exit code.

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
    { "id": "node", "ok": true, "label": "Node ≥ 24", "detail": "24.13.0" },
    { "id": "git", "ok": true, "label": "git installed", "detail": "git version 2.54.0" },
    { "id": "claude-code", "ok": true, "label": "Claude Code installed", "detail": "2.1.299 (Claude Code)" },
    { "id": "login", "ok": true, "label": "Logged in with a subscription", "detail": "you@example.com" },
    { "id": "profile", "ok": true, "label": "Lean profile", "detail": "already in place" },
    { "id": "context-format", "ok": true, "label": "Claude Code /context output", "detail": "recognized" },
    { "id": "startup-context", "ok": true, "label": "Startup context", "detail": "10.9k estimated tokens, project skills: project-brief" }
  ],
  "profile": { "changes": [], "pending": [] },
  "context": {
    "totalTokens": 10900,
    "sections": {
      "Estimated usage by category": { "found": true, "rows": 8 },
      "Skills": { "found": true, "rows": 1 },
      "Memory Files": { "found": true, "rows": 1 }
    },
    "counts": { "categories": 8, "skills": 1, "projectSkills": 1, "memoryFiles": 1 },
    "projectSkills": ["project-brief"],
    "memoryFiles": [{ "type": "Project", "file": "CLAUDE.md", "tokens": 496 }],
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
| `profile` | `changes`: what this run changed in the profile; `pending`: what it would change but did not, because of `--check`. One of the two is always empty. `null` if the profile check did not run. With `--check`, a non-empty `pending` makes the `profile` check, and `ok`, false. |
| `context` | `null` if `/context` was not read. If its format was not recognized, only `sections` is present. Otherwise: `totalTokens` (estimated startup context), `sections` (`found` and `rows` for each section `doctor` depends on), `counts`, `projectSkills`, `memoryFiles` (with `file` as a base name), and `leaks` (skills and MCP tool groups that should not be loaded). |
| `warnings` | Things worth fixing that do not make `ok` false. Each has an `id`, a `message`, and fields specific to its `id`. `budget`: `file`, `tokens` and `budget`. `provisional-project`: no extra fields. `template`: `files`, a list of `{ path, status }` where `status` is `new`, `update` (unchanged in the project, safe to replace) or `modified` (changed in the project); it is empty when the files cannot be compared, and the message says why. |

Check `id`s in v1: `project`, `node`, `git`, `claude-code`, `login`, `profile`, `context-format`, `startup-context`.

Without `--check`, `doctor --json` applies fixes like the plain command: it may update the profile and `.gitignore`, and lists what it changed in `profile.changes`. With `--check`, `/context` reports what Claude Code loads with the files as they are, so `context.leaks` may list skills that a fix would turn off.
