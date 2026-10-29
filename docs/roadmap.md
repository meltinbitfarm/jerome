# Roadmap

1. ✓ Project creation and setup checks (`jerome new`, `jerome init`, `jerome doctor`)
2. ✓ Lead agent instructions, now in `.claude/rules/jerome.md`
3. ✓ Briefing anywhere and import of a brief (`jerome prompt`, `jerome new --from-file`), template updates (`jerome update`)
4. ✓ Rules for creating subagents, including a documentation agent (`jerome docs`)
5. ✓ A SQLite database per project, outside the working tree, read with `jerome state` and `jerome digest`
6. ✓ Usage tracking through hooks and the status line (`jerome hook`, `jerome statusline`)
7. ✓ Read-only local viewer (`jerome view`), and every project at a glance (`jerome projects`)
8. ✓ Scheduled headless runs, with a lock and a cap per run (`jerome schedule`, `jerome heartbeat`, `jerome request`); since 0.2.0 with slots, RESUME runs, an end check, a max duration, alerts and marathons
9. ✓ Daily and weekly limits with automatic pause (`jerome limits`)
10. ✓ Telegram bridge and watchdog (`jerome telegram`, `jerome watchdog`), since 0.3.0; blocks cleared with a button since 0.9.0
11. ✓ Quota governor on one Mac (`jerome governor`, `jerome quota`), since 0.4.0. Jérôme Director, the coordinator of several Macs ([director.md](director.md)), is in progress: the Macs connect and report since 0.5.0, the dashboard since 0.5.1, each project's board since 0.11.0; the permits and Telegram on the Director come next
12. Areas and milestones, with the area briefing (`.jerome/areas.md`): in place and tested, not yet tried on a real project

Along the way: `jerome deps` lists what Jérôme depends on in Claude Code, and `jerome forget` removes the database of a project that is gone.

The detailed plan, phase by phase, with each version and its decisions, is in [PLAN.md](../PLAN.md).
