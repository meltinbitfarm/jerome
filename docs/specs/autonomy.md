# Autonomy

Status: approved by Fabio on 2026-10-28 (D158-D163); D164 and D165 added while building it.

## Why

On 2026-10-28 the first look at the Director's dashboard showed what Fabio had felt for days: of the last 17 heartbeats on the Mac Mini, 12 ended blocked or stopped, and Telegram sent him lines such as "token cap: 505,776 tokens over 500,000 (main 506k); end check: uncommitted changes (.claude/settings.json)…". A team of agents that stops every half hour and waits for him is not autonomous. In his words: "non voglio dover rispondere a mille domande sempre".

The causes, from the dashboard and the code:

| What stopped | Why | Whose |
|---|---|---|
| `uncommitted changes (.claude/settings.json)`, at the start and at the end check | each heartbeat runs `jerome doctor` with `fix`, which rewrites the hooks and the status line in `.claude/settings.json` after an update of Jérôme, and leaves the change uncommitted | Jérôme's own |
| `jerome doctor failed: Startup context: 20.9k estimated headless` | a size warning counted as a failure, and a failure stops the run with a request to Fabio | Jérôme's own |
| `uncommitted changes (.jerome/open.md) on v2-la-via`, 5 runs in a row overnight | state files the run should carry (D127) and did not | Jérôme's own, cause to find |
| `token cap: … next run resumes`, as an alert | a run stopped by its budget, which the next one resumes; shown as a failure | not a problem |
| `permission denied for Bash(python3 …)` | heartbeats may run only the commands of a list | a rule too narrow |

None of these needed Fabio.

## What changes

### 1. Jérôme repairs what is its own (D158)

- Whatever Jérôme writes in a project is committed by Jérôme, by its paths, with a message saying so: the hooks and status line `doctor` writes in `.claude/settings.json`, `.jerome/project.json`, the state files. Doctor's fix commits its own change; the start of a run carries any change limited to Jérôme's files, on the main branch or the one it works on.
- Doctor's warnings never stop a run: only a check without which the run cannot work does (the folder not trusted, no database, a broken settings file). The startup context's size is a warning.
- A run stopped by its token or turn cap is a normal end: the next run resumes, and no alert is raised. It becomes an alert only when the same work is stopped three times in a row.
- Why climbdaily's `open.md` was not carried is found from the Mac Mini's logs, and fixed.

### 2. Heartbeats run any command, but a blacklist (D159)

Fabio's choice: in a heartbeat the lead agent and its agents may run any command available on the machine (python3, node, npm, the project's scripts, …) without asking. Still refused:

- pushing, merging or releasing on GitHub, publishing packages or images, deploying, sending mail (the deny rules of D46, unchanged);
- `sudo` and `su`;
- deleting outside the project's folder;
- reading credentials: the Keychain (`security`), `~/.ssh`, `~/.aws`, `~/.config/gh`, `.env` files outside the project;
- downloading and running a script in one go (`curl … | sh`).

The deny rules stay in `.claude/settings.json`, which Claude Code applies even with permissions bypassed; what a pattern cannot express (a path outside the project, a pipe into a shell) is checked by Jérôme's PreToolUse hook, which refuses with the reason so the agent goes another way.

### 3. Fabio is asked only real decisions (D160)

- A request is for a choice about the product or how to build it, which only Fabio can make. A technical obstacle is never a request: the agent solves it or goes around it, and notes it in the digest.
- The runner never opens a request on its own: what it opened before (doctor, a trust dialog, a permission) becomes a block it reports, as in 4.
- A block Jérôme cannot clear reaches Fabio only when it lasts: three runs in a row, or six hours. Then one message, in plain words, with the one thing to do ("Climbdaily è fermo da 6 ore: apri `claude` nella cartella una volta e accetta la fiducia").

### 4. Notifications carry only what needs Fabio (D161)

- Telegram and the macOS notifications send only: a new decision request, and a block that lasts as in 3. Never a reason as the runner writes it, a path, a token count or a command.
- Each kind of block has its message written for a person, in Fabio's language; the technical reason stays in `jerome heartbeat status` and on the Director's dashboard, under "details".

### 5. Jérôme speaks the user's language (D162)

- The language is the user's, from the system (macOS's preferred language; `LANG` elsewhere), and `jerome language <code>` sets it. Italian for Fabio.
- In that language: notifications, Telegram, decision requests and their options (the lead agent is told to write them so), the dashboard. The repository's files, the digest and the docs stay in English, and so, for now, do the terminal commands such as `jerome projects` (D165).
- The weekly quota running fast is told too, once a day at most (D164).

### 6. Then the dashboard, simpler (D163)

After 1-5, the dashboard is redone in the user's language: on top "Cosa devi fare tu", the requests to answer and the lasting blocks, each in one sentence; under it "Tutto il resto va avanti da solo", one line per project; the runs, the quota and the details closed until opened.

## Order

Each step is committed apart and usable alone: 1, 2, 3 with 4, 5, 6.
