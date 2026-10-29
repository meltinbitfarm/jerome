# Quota governor

The subscription's quota belongs to the account, not to a project or a machine. When it is not used by the time the week resets, it is lost. The quota governor reads the real quota and starts work in your projects while the week is behind its pace. The goal is to reach each weekly reset with about 90% used, and to leave you room for your own work. This is phase 1 of the [spec](specs/quota-governor.md): one Mac, no server (D140-D143). Phase 2 is Jérôme Director, the coordinator that will run on a server for several Macs (D138, D139).

```sh
jerome governor on            # on this Mac (default: 90% target, 20% reserve, 5h cap 90%)
jerome governor add           # in each project that may be given fill runs
jerome quota                  # the windows as they are now, and the verdict
jerome governor status        # the same, with the settings, the projects and what a run costs
```

It needs the [watchdog](commands/watchdog.md) (`jerome watchdog install`), which runs it every minute.

## Where the quota comes from

`jerome quota` and the watchdog ask Claude Code's own usage endpoint, `api.anthropic.com/api/oauth/usage`. That is what Claude Code's `/usage` shows. Its answer covers the 5-hour and 7-day windows, the weekly limits scoped to one model, and the week's share by surface (Claude Code, chats). It covers the whole account, so your own use of claude.ai and Claude Code is already in it.

- **When it is read:** at most every 5 minutes, and before and after each run of the lead agent while the governor is on. Each reading is kept in `~/.config/jerome/account.json`, next to the readings from the status line and from the runs.
- **The login:** the endpoint is called with Claude Code's own subscription login. On macOS that is the Keychain item `Claude Code-credentials`; elsewhere it is `.credentials.json` in Claude Code's folder.
- **The token stays on the Mac.** It is read only to make that one call. It is never written, logged or printed, and never sent anywhere else (D139).
- **An expired login is not renewed here.** Renewing it would replace Claude Code's own token. Claude Code renews it the next time it runs.
- **The endpoint is not documented.** Only `src/quota.js` knows it, and `jerome deps` lists the fields it reads.
- **When it fails** (expired login, no answer, a changed format), the governor goes on with the other sources' readings. Once the newest reading is more than 30 minutes old, it starts nothing: scheduled slots still run, but there are no fill runs.

## The pace

These numbers are the defaults:

- **Target:** the 7-day window should reach 90% by its reset. Its curve rises evenly from the start of the week, read from the window's own reset time (it is not a calendar week), to the reset.
- **Behind the curve:** a fill run may start.
- **Reserve:** 20% is kept for your own use, so no fill run starts above 80%. In the last 24 hours before the reset the reserve is released evenly, because what is left at the reset is lost.
- **5-hour cap:** no heartbeat starts at or above 90% of the 5-hour window.
- **5-hour burst:** when the 5-hour window resets within the hour with at least 20 points of room, work may start up to 12 hours ahead of the curve.
- **Scoped limits:** a model whose own weekly limit is ahead of the curve gives way to Sonnet for that run, which says so in its reason.
- **Your own work:** nothing pauses while you work. Your use is already in the reading.

Change the settings with `jerome governor on --target 95 --reserve 15 --five-hour-cap 85`.

## Fill runs

Each minute the watchdog asks for the verdict. On a go, it starts `jerome heartbeat fill` in one of the governor's projects (D144). Fill runs go in parallel, at most one per project, but they start staggered:
- a new one starts at least 5 minutes after the last;
- and only on a reading of the quota taken since then, so the pace sees what the runs already going are taking before it adds one.

Control starts at once, not at the end of the week: the pace is worked out again at every reading, every 5 minutes. As soon as the week reaches its curve, the 5-hour window its cap, or the reserve is touched, no new run starts. The runs already going are not stopped: each one ends within its project's `maxMinutes`.

**Which project.** It picks the project whose last heartbeat is oldest, skipping any project that:
- has an open alert;
- is at its own daily or weekly limit;
- started a heartbeat in the last 30 minutes;
- has a slot due before a run started now could end (its `maxMinutes`), so the slot's run never finds the project locked (D176).

**How a fill run differs from a scheduled one.** It goes through the same checks, triage and end check. It is told the quota is behind, and:
- an area's pace does not hold it back; a paused area, or one waiting for a milestone decision, still does;
- if no area has a task, it may take one from the `## Backlog` section of `open.md`.

**The backlog** holds work that needs nobody: tests, refactors, research. The lead agent adds to it what it notices along the way and removes an item once it is done. New projects get the section empty; add it to `open.md` in older ones.

**Scheduled slots** keep running as before. With the governor on, they also hold at the 5-hour cap and at the reserve, but not for being ahead of the curve: they were scheduled on purpose.

The fixed limits stay in force as a ceiling: the global % thresholds of [`jerome limits`](limits.md) and each project's daily and weekly dollars. A project's default limits ($5 a day, $20 a week) are small for this use. `jerome governor add` reminds you of them, and `jerome limits --daily … --weekly …` changes them.

## What a run costs

While the governor is on, each run of the lead agent saves the 5-hour and 7-day readings from before and after it, with its model. `jerome governor status` shows the average 7-day points per run and per model over the last week. Phase 2 will use these figures to size permits.

## One Mac only

Every Mac reads the same account. Two governors would both see the week behind and both fill it. Until Jérôme Director coordinates them, turn the governor on on one Mac only. On the others, heartbeats run on their slots.

## Where it shows

- **The status line:** `pace 6.4% ▲`. The number is where the week should be now; the ▲ means fill runs may start.
- **`jerome projects`:** a `governor` line.
- **Telegram:** the `/status` answer.
- **The watchdog's log:** each change of verdict and each fill run started.
