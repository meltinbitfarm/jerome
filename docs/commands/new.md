# `jerome new <name>`

Creates a new Jérôme project in the folder `<name>`, relative to the current directory.

```sh
jerome new my-project
jerome new my-project --from-file brief.md
pbpaste | jerome new my-project --from-file -
```

## What it does

1. **Checks the setup first.** Node.js 24 or later, git, Claude Code, and a Claude Code login through a claude.ai subscription. If any check fails, the command stops and **nothing is created**.
2. **Copies the template.** Only the paths listed in `template/MANIFEST` are copied. Jérôme's own development files never end up in a project.
3. **Creates the `.jerome` marker** at the project root. Jérôme commands and the briefing skill use it to recognize a project. It records the Jérôme version and the template files as copied, which [`jerome update`](update.md) uses later.
4. **Writes the project files from the brief**, with `--from-file` (next section).
5. **Initializes git** (`git init`, branch `main`). No commit is made.
6. **Makes the default limits binding**: writes into `.claude/settings.json` the permission rules that deny pushing, publishing, deploying and sending email, and allow the safe local git operations and tests (see [agents.md](../agents.md#binding-limits)). The allow rules take effect once you open `claude` in the project and accept the trust dialog.
7. **Creates the project database**, `.jerome.db`, kept out of git (see [database.md](../database.md)).
8. **Writes the lean profile** into `.claude/settings.local.json`, adds that file to `.gitignore`, and verifies the profile, exactly as [`jerome doctor`](doctor.md) does.

The template brings three skills: `project-brief` for the briefing, `project-team` with the agent catalog, and `docs`, run only when you type `/docs`. The project has no agents yet: the lead agent proposes them after the brief (see [agents.md](../agents.md)).

## Importing a brief

`--from-file <path>` reads a brief from a file, and `--from-file -` from standard input, so you can pipe the clipboard into it. The brief is read and checked first: when it cannot be imported, nothing is created.

- **Code fences are removed.** Chats often wrap the brief in ` ```markdown ` fences, and their "copy" buttons keep them. If the text holds fenced blocks, the first one that starts with front matter is taken as the brief.
- **Stray text is left out.** Chats often add a sentence before the brief. Text before the front matter, and between the front matter and the first section, is ignored with a warning that quotes its start, so a valid brief with a preamble is still imported at zero tokens. `brief.md` keeps the full text.
- **A valid `brief/v2` or `brief/v1`** is sorted by the CLI, without the model and at zero tokens, following the "Import" table of the format: goal, constraints and agent limits into `PROJECT.md` (titled with the brief's `name`), loaded at every turn; context, out of scope, success, tools and pace into `scope.md`, read when needed; decisions into `decisions.md`; open questions and parked topics into `open.md`. Nothing is dropped, however long the brief. The text is also saved as `brief.md`. A brief with `status: draft` is imported with a warning.
- **A declared format this version does not know**, such as `format: brief/v3`, stops the command: the brief probably comes from a newer Jérôme, so update it.
- **Any other text**, including a `brief/v2` with missing or unexpected sections, or without front matter, is saved as it is in `brief.md`, with a warning that says why it is not a valid brief. The CLI also writes a provisional `PROJECT.md` that tells the lead agent to convert it before any other task, in your first session: it lists the decisions it finds and asks you to confirm them in one block, because a text from another chat may contain the model's proposals that you never confirmed. Until then, `jerome doctor` warns that `PROJECT.md` is provisional.
- **An empty input** is an error.

The folder name is always the one you give to `jerome new`. To write a brief in the right format in any chat, start from [`jerome prompt`](prompt.md).

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
✓ Default limits — 60 permission rules added to .claude/settings.json
✓ Project database — .jerome.db created (schema 1)
✓ Lean profile updated (22 changes):
    disableClaudeAiConnectors = true
    disableBundledSkills = true
    enabledPlugins.some-plugin@marketplace = false
    …
✓ Startup context: 11.2k estimated tokens, project skills: project-brief, project-team

Ready: cd my-project && claude
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Project created, lean profile verified |
| 1 | Setup check failed (nothing created), folder already exists, brief unreadable, empty or in an unknown format (nothing created), or profile not lean |
| 2 | Wrong usage |
