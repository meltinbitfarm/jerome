# Open

## Open questions
- Q1: (superseded, see D16) Name of the tool.
- Q6: (resolved by D32) (from D30) Where project customizations of the lead agent's instructions live: a section of PROJECT.md, or a dedicated file imported by the template's CLAUDE.md with `@`.
- Q7: How do we see whether the week's quota reached the governor's 90% target at each reset (success criterion of docs/specs/quota-governor.md)? No measure of it was found in the docs; whether the code keeps one is unchecked.

## To do
- O1: Director step 3 (docs/specs/director.md, docs/director.md): permits for fill runs, slots that queue, a slower pace when the Director cannot be reached; a Mac that goes off leaves its slots to the other. Steps 4 (setup on the server) and 5 (Telegram on the Director) follow.

## Parked
- P1: talking to the lead agent from Telegram (Claude Code Channels) — the bridge without a model (D130-D134) covers notifications, answers, notes and /status; a conversation with the lead agent stays parked.
- P4: an outside check for a Mac that is off (the watchdog pinging a service that alerts when the pings stop, D135) — when a machine runs heartbeats nobody sits at.
- P2: Zero-step start (a Mac Mini that creates projects on its own from the briefs in MementoVault) — not of interest for now.
- P3: MementoVault integration (importing briefs and saving them to a store), removed by D33 — a possible future extension.
- P4: Spending limits per area (D95-D104 keep the project's daily and weekly limits) — when one area's usage needs a cap of its own.
- P5: The area briefing from claude.ai, imported through the CLI — once the area briefing in Claude Code is in use.
- P6: Working on one project from more than one machine: decisions and state travel with git, while the history, the usage and the decision requests stay in the machine's database (D93). The least that would help is keeping at least the requests in a versioned file — postponed.
