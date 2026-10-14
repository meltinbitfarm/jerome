# `jerome new <name>`

Creates a new Jérôme project in the folder `<name>`, relative to the current directory.

```sh
jerome new my-project
```

## What it does

1. **Checks the setup first.** Node.js 24 or later, git, Claude Code, and a Claude Code login through a claude.ai subscription. If any check fails, the command stops and **nothing is created**.
2. **Copies the template.** Only the paths listed in `template/MANIFEST` are copied. Jérôme's own development files never end up in a project.
3. **Creates the `.jerome` marker** at the project root. Jérôme commands and the briefing skill use it to recognize a project.
4. **Initializes git** (`git init`, branch `main`). No commit is made.
5. **Writes the lean profile** into `.claude/settings.local.json`, adds that file to `.gitignore`, and verifies the profile, exactly as [`jerome doctor`](doctor.md) does.

## Safety

- If `<name>` already exists, even as an empty folder, the command stops without changing anything.
- If the lean profile cannot be fully applied, the project is still created, the command exits with code 1 and lists what is still loaded. Fix it, then run `jerome doctor`.

## Example

```
$ jerome new my-project
✓ Node ≥ 24 — 24.13.0
✓ git installed — git version 2.54.0
✓ Claude Code installed — 2.1.299 (Claude Code)
✓ Logged in with a subscription — you@example.com
✓ Project created in /Users/you/my-project
✓ Lean profile updated (22 changes):
    disableClaudeAiConnectors = true
    disableBundledSkills = true
    enabledPlugins.some-plugin@marketplace = false
    …
✓ Startup context: 10.4k estimated tokens, project skills: project-brief

Ready: cd my-project && claude
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Project created, lean profile verified |
| 1 | Setup check failed (nothing created), folder already exists, or profile not lean |
| 2 | Wrong usage |
