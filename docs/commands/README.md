# Commands

Every command of `jerome`, each with its own page. `jerome --help` prints the same list with every option. For which ones you use day to day, and in what order, see [Using it](../../README.md#using-it) in the README.

| Command | What it does |
|---|---|
| [`jerome version`](version.md) | Prints the installed version; also `jerome --version` and `jerome -v` |
| [`jerome new <name> [--from-file <path\|->]`](new.md) | Creates a project from the template, with git and the lean profile, optionally from a brief |
| [`jerome init [dir]`](init.md) | Brings Jérôme into an existing project, overwriting nothing |
| [`jerome prompt`](prompt.md) | Prints the briefing instructions, to paste into any chat |
| [`jerome doctor [dir] [--check] [--json]`](doctor.md) | Checks the setup and restores the lean profile of a project; `--check` only reports, `--json` gives a machine-readable report; relinks the database of a project that moved |
| [`jerome forget <key>`](forget.md) | Removes the database of a project that is gone, after a backup |
| [`jerome language [code]`](language.md) | The language Jérôme writes to you in: notifications, Telegram, decision requests (`en`, `it`) |
| [`jerome update [dir] [--check] [--yes]`](update.md) | Brings a project's template files up to the installed version, without touching its state |
| [`jerome state [dir] [--json]`](state.md) | Shows a project's usage, areas, runs and open decision requests in a few lines, with dollars as API equivalents |
| [`jerome view [dir]`](view.md) | Opens a read-only page in the browser: at the top the project's [board](../board.md) (now, to do, done, in plain words in your language, with a **?** button for help, the legend of the IDs and the guides), then the team, areas, runs, usage, subscription windows and the messages between agents |
| [`jerome projects [--json] [--view]`](projects.md) | Shows every project on this machine, from any folder, with what needs you first; `--view` as a page in the browser |
| [`jerome schedule [dir] hourly\|daily\|weekly`](schedule.md) | Schedules heartbeats, runs of the lead agent without you, with a cap per run (macOS) |
| [`jerome heartbeat [dir]`](heartbeat.md) | One scheduled run, as launchd starts it; `install`, `uninstall`, `status`, `run <slot>`, `marathon --until HH:MM` and `override --today` for a project's slots and their runs |
| [`jerome request`](request.md) | Opens and closes decision requests |
| [`jerome telegram setup`](telegram.md) | Connects a Telegram bot: what waits for you from every project, answers to requests, notes, `/status`, and buttons that clear a block from afar (allow a tool, trust a folder, try again, skip); no model, zero tokens |
| [`jerome watchdog install`](watchdog.md) | The machine's job, every minute: closes lost runs, reports heartbeats that did not start, has the boards' new texts put in plain words, runs the Telegram bridge, the quota governor and the beat to the Director |
| [`jerome connect`](connect.md), [`jerome director`](director.md) | [Jérôme Director](../director.md): one coordinator for all your Macs, on your server with Docker, reached over any VPN, with signed requests and answers, and a dashboard for the phone with each project's board |
| [`jerome governor on`](governor.md), [`jerome quota`](quota.md) | The quota governor: reads the subscription's real quota and starts fill runs while the week is behind its pace, to reach the weekly reset at about 90% |
| [`jerome note`](note.md) | Lists and closes the notes you sent a project from Telegram |
| [`jerome digest [dir]`](digest.md) | What happened recently, at zero tokens |
| [`jerome limits [dir]`](limits.md) | Shows and sets the usage limits that pause heartbeats: global in % of the subscription windows, per project in API-equivalent dollars |
| [`jerome deps [--json]`](deps.md) | Lists what Jérôme depends on in Claude Code, for tools that watch Claude Code releases |
| [`jerome docs [dir]`](docs.md) | Brings the documentation queue into the project's docs, with the documentarist on Haiku |
| [`jerome hook <event>`](hook.md), [`jerome statusline`](statusline.md) | Run by Claude Code, not by you: they record usage and show the status line |
