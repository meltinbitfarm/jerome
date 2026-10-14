# `jerome doctor [dir]`

Checks the setup and restores the lean profile of a Jérôme project. `dir` defaults to the current directory and must contain the `.jerome` marker.

```sh
cd my-project
jerome doctor
```

Run it whenever you install a plugin, sync new skills from claude.ai, or move the project to another machine. Scheduled runs will call it before every run.

## What it does

1. **Runs the same setup checks as `jerome new`**: Node.js, git, Claude Code and subscription login.
2. **Rebuilds the lean profile from what is installed now.**
   - It reads the installed plugins from `claude plugin list --json`.
   - It reads the skills synced from claude.ai from the Claude Code config folder.
   - It writes the result into the project's `.claude/settings.local.json`, and makes sure `.gitignore` excludes that file.
   - Profile entries left in `.claude/settings.json` by earlier versions are moved to the local file.
3. **Verifies what Claude Code actually loads** by running `claude -p "/context"` in the project. This is a local command: it makes no API call, uses no tokens and saves no session.
   - Any skill that is not a project skill, and any MCP tool without a project `.mcp.json`, counts as a leak.
   - Leaked skills that can be turned off are added to `skillOverrides`, and the check runs once more.

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
| 1 | A setup check failed, the folder is not a Jérôme project, or something is still loaded that should not be |
| 2 | Wrong usage |

If `/context` output changes format in a future Claude Code release, `doctor` fails with an explicit error instead of reporting a false pass.
