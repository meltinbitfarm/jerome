# The project-brief skill

Every Jérôme project starts from a brief: a short, structured document with the project's goal, constraints, decisions and open questions. The `project-brief` skill runs the briefing conversation and writes the brief. It ships with the template in `.claude/skills/project-brief/`.

## Using it

Tell Claude you want to start something: "I have an idea", "let's do the briefing", or the same in your own language. The skill asks one question at a time, challenges choices that cost tokens or add complexity, and records each decision with its reason. When you are done, say "save the brief". Before saving, the skill lists the decisions it proposed and you never explicitly confirmed, and asks you to confirm them in one block: silence is not confirmation, and whatever you don't confirm goes under Open questions.

The briefing happens in the language you write in. The brief's section headings stay in English, so the CLI can read any brief.

## Where the brief goes

| Where you are | What happens |
|---|---|
| Claude Code, inside a Jérôme project | The brief is split into `PROJECT.md`, `decisions.md` and `open.md`, and a full copy is saved as `brief.md` |
| Anywhere else, with a supported store available | The brief is saved in the store (today: MementoVault) |
| Anywhere else, no store | The brief is shown as a markdown block for you to copy |

In Claude Code you can choose the store explicitly in `~/.config/jerome/config.json`:

```json
{ "storage": "mementovault" }
```

Use `"none"` to always get the markdown block. Each store has an adapter file in `references/storage-<name>.md`, which the skill reads only when it uses that store.

## Using it on claude.ai

To run briefings from claude.ai, for example from your phone, upload the skill there. From the root of this repository, build a zip that contains the `project-brief` folder:

```sh
mkdir -p dist && (cd template/.claude/skills && zip -r -X ../../../dist/project-brief.zip project-brief -x '*.DS_Store')
```

Then upload `project-brief.zip` in the Skills section of your claude.ai settings. If you uploaded an earlier version, replace it. With a store connected on claude.ai, a brief saved from the phone can be imported later on the PC.

## Connecting the CLI to MementoVault

To import a brief saved in MementoVault with `jerome new <name> --from-vault <slug>` (in progress, phase 3), the CLI needs the URL of your MementoVault MCP endpoint and a token. Create a workspace token in MementoVault just for Jérôme, so you can revoke it on its own, then write `~/.config/jerome/mementovault.json`:

```json
{
  "url": "https://your-mementovault.example/mcp",
  "token": "cv_ws_..."
}
```

and make it readable only by you:

```sh
chmod 600 ~/.config/jerome/mementovault.json
```

The token never goes in a project. MementoVault tokens have no read-only mode, but the CLI only lists and reads documents. It finds the brief as the document titled "Brief" in the project's collection, because document slugs are unique across the whole workspace: a second project's brief may have the slug `brief-2`.

## Format

The format is `brief/v2`, described in [`references/brief-v2.md`](../template/.claude/skills/project-brief/references/brief-v2.md). Briefs in the older `brief/v1` format, which had Italian section headings, are still accepted on import.
