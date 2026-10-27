# Replacing ad-hoc heartbeat scripts with `jerome heartbeat install`

This note is for a project whose autonomous runs are started by scripts of its own (a shell script calling `claude -p`, a launchd plist or cron line written by hand, a "run until hour X" loop), often written by the lead agent itself. It is written so that the lead agent of any project can follow it alone, in a session with the user; the only steps that need the user are marked.

## Why

Jérôme's runner (D118-D125) guarantees what such scripts usually miss:

| Ad-hoc script | `jerome heartbeat` |
|---|---|
| `claude -p` kills background subagents 10 minutes after the lead's last turn | `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`, foreground delegation in the prompt, and a hard max duration instead |
| "not on main" → skip, silently, for hours | a work branch or what a heartbeat left → RESUME run; anything else → skip with an alert at once |
| nothing checks how a run ended | end check after every run: on main, clean tree, no merge in progress, digest line, exit 0 in time |
| repeated skips go unnoticed | two in a row for the same reason → alert, shown first in `jerome state` and at session start |
| "until hour X" compares the hour only, and never stops after midnight | `marathon --until 24:00` compares date and time, and stops at midnight |
| interactive edits and commits mix with the run's | the hook refuses repo-changing git in sessions while a run holds the lock; `commit -a` and `add -A` are refused always |
| a crashed run leaves a lock or a half-done branch | stale locks are taken over; half-done branches are resumed |

## Steps

1. **Update Jérôme and the project.** `npm i -g github:meltinbitfarm/jerome` (or the user's usual install), then `jerome update` and `jerome doctor` in the project. The project's database gets schema 6 (alerts, run modes) on its own.

2. **Read the old setup, and write down what it did.** List the scripts and scheduler entries (for example `ls ~/Library/LaunchAgents`, `crontab -l`, the project's `tools/` or `scripts/` folder). For each run note: its times and days, the extra instructions it gave the lead agent, the branch it expected, its time limit, its quota threshold, its test command, and where it sent notifications.

3. **Map them to settings**, under `heartbeat` in `.jerome/project.json` (see [heartbeat.md](heartbeat.md#slots)):
   - each scheduled time with its own instructions → one slot, `{ "name": "evening", "at": ["18:00"], "days": [...], "text": "..." }`; times sharing the same instructions → one slot with several `at`;
   - the branch it worked on → `mainBranch`, and the prefix of its work branches → `workBranch` (default `agent/*`);
   - a timeout → `maxMinutes`; a quota threshold → `quota.fiveHour` / `quota.sevenDay`; the test command → `test`;
   - instructions common to every run, beyond Jérôme's own prompt → `prompt` (one line). Drop those Jérôme's prompt already gives: one task, branch, foreground delegation, no push or deploy, merge when tests pass, digest line, end on main clean;
   - a notification hook → `alerts.command`. **No secret in it:** `project.json` is versioned. Move a webhook URL or token to a file outside the repository (such as `~/.config/jerome/<name>`) or the keychain, and have the command read it.

   An "until hour X" loop needs no setting: it becomes `jerome heartbeat marathon --until HH:MM`, started by hand.

4. **Propose the mapping to the user** (needs the user): the slots, the settings and what is dropped, in one block, with the old setup next to it. Record their confirmation as a decision.

5. **Stop the old setup before starting the new one** (needs the user to confirm each removal): unload and delete each old job (`launchctl bootout gui/$(id -u)/<label>`, then delete its plist), remove the cron lines, and stop any loop still running (`ps aux | grep claude`). Two schedulers on one project would race, and the old one bypasses every guarantee. Move the old scripts to an `archive/` folder or delete them, with a commit of their own.

6. **Bring the repository to its start state.** `git status` and `git branch`: the tree must be on `main` and clean. A half-done branch left by the old runs can stay if it matches `workBranch`, and the first run will resume it; rename it to match (`git branch -m old agent/old`) if it does not. Your own uncommitted changes must be committed or discarded by the user, otherwise the first run is skipped with an alert.

7. **Install and check.**
   ```sh
   jerome heartbeat install
   jerome heartbeat status
   jerome doctor
   ```
   `install` refuses settings it cannot use and says what to fix. `doctor` checks each job is loaded and its paths exist.

8. **Try one run by hand**, with low caps, and read its end check:
   ```sh
   jerome heartbeat run <slot> --max-tokens 100000
   jerome heartbeat status
   ```
   The run's line shows its mode, length, exit code and `end check ok` or what failed; a failure is an alert, and the next run resumes.

9. **Update the project's own instructions.** Remove from `PROJECT.md`, `CLAUDE.md` or notes any rule about the old scripts (how to start them, the branch check, the hour loop). Jérôme's rules (`.claude/rules/jerome.md`, updated by `jerome update`) now say to run unattended work only with `jerome heartbeat`.

10. **Record it** in `decisions.md`: the scripts replaced, the slots and settings chosen, and what was dropped, with the reason.

## Afterwards

- `jerome heartbeat status` is the first place to look; `jerome state` shows alerts on its first lines, and a new session starts with them.
- Change slots by editing `.jerome/project.json` and running `jerome heartbeat install` again; it removes the jobs of slots taken out.
- To stop: `jerome heartbeat uninstall` (settings kept), or `jerome schedule --off` (jobs and schedule removed).
