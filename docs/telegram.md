# Telegram

Jérôme can reach you on Telegram, for every project on a machine, and you can answer from there (D130-D134). It is a bridge, not a chat with the lead agent: no model reads your messages there, and it costs no tokens.

## Setting it up

1. In Telegram, create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`), and copy its token.
2. On the machine where your projects run:

   ```sh
   jerome telegram setup
   ```

   Paste the token (it is not echoed), then send `/start` to your bot from your own Telegram account. Jérôme shows who the message came from and asks you to confirm: from then on, only that private chat is heard. It installs the [watchdog](commands/watchdog.md), the machine's job that keeps the bridge running, and sends you a test message.

The token is kept in `~/.config/jerome/telegram.json`, readable by you only (`600`, in a `700` folder), never in a project or a log; `jerome doctor` warns if others can read it. The bridge is a listener of its own (D184), always asking Telegram for new messages (`getUpdates` with long polling, at most 10 seconds a call), so a tap or a message is handled within a second or two, and a message queued for you goes out within 10 seconds: the Mac calls Telegram, and nothing on the machine listens on the internet. The watchdog starts the listener when none runs; it ends by itself every 30 minutes, and at once after an update of Jérôme, so the next one runs the new code. `jerome telegram status` says whether it is listening; its lines go to the watchdog's log. After it writes your answer, note or action, it sends the [Director](director.md)'s beat at once, when this Mac is connected to one (D193).

## What you get

Only what needs you (D160, D161), from every project, with its name first, in [your language](commands/language.md):

- decision requests, opened by a heartbeat or in a session, with their options as buttons;
- [blocks](heartbeat.md#alerts) that last (three runs in a row or six hours), as one sentence with the one thing to do, then once a day while they stay open; this includes [missed starts](heartbeat.md#missed-starts) and [lost runs](heartbeat.md#lost-runs) that go on;
- the weekly quota running fast: when it rose in the last 24 hours by more than twice the pace that ends the week at its target, once a day at most, with when it would run out at that speed (D164). It needs no governor: the watchdog reads the quota itself, on this Mac only.
- each answer, note or action sent from the [Director's dashboard](director.md#acting-from-the-dashboard), once the Mac has run it, so an order you did not send is seen at once (D191).

Never a runner's reason, a path, a token count, a single failed run or a pause for a limit: those are in `jerome heartbeat status` and on the [Director's dashboard](director.md). `/status` answers with the open requests and blocks of every project, in the same words, and the quota.

The macOS notifications stay, and `heartbeat.alerts.command` stays for other channels. A message Telegram refuses is retried every minute for 2 days.

## What you can send

| You send | What happens |
|---|---|
| a tap on an option of a request | the request is answered with that option, through `jerome request answer` in its project |
| a reply to a request's message | the request is answered with your text |
| a tap on a block's button | that one action, in that project (see below) |
| a reply to any other message of a project | your text becomes a note for that project |
| `#project text` | a note for that project |
| any other text | a note: for the only project, or Jérôme asks which one, with a button each |
| `/status` | what waits for you in every project, from `jerome projects`, then each block with its buttons |
| `/help` | what you can send |

Messages are laid out for the phone (D186): the project's name in bold on its own line, then the text. A request shows its question, each option on its own line, the recommendation, and how to answer in italics. Every text is escaped for Telegram's HTML, and a message Telegram refuses that way goes again as plain text, with the same lines.

Each option of a request is a button. The options are read however the agent wrote them: labelled in order (`A) … B) …`, `A: …`, `1) …`), split at the labels so a `/` or `;` inside an option stays in it, or else separated by ` / `, `;`, ` | ` or ` · `. A request with fewer than two options, or more than six, has no buttons, and its message says to reply instead.

A request's buttons follow it. Once it is closed in any way (a tap, a reply, a session, the dashboard, dropped) they are taken off its message within a minute, so no tap goes to a question that is no longer open; a message of an open request sent with none gets them when its options can be read. An answer that fails leaves the buttons, for another tap, and a tap on an old message whose buttons Telegram no longer lets the bridge change gets the reply that the request is already closed.

## Unblocking with a button

A block comes with one to three buttons, chosen by its kind (D166, [the spec](specs/unblock.md)):

| Block | Buttons |
|---|---|
| your uncommitted changes | **Commit them** (by their paths, "Kept by the user from afar") · **Set them aside** (`git stash`, found again with `git stash list`) |
| stopped at its budget on the same work | **Twice the budget, one run** (starts now) · **Skip it, go on** (a note tells the next run to take another task) |
| needed a tool its runs may not use (the message names it) | **Allow it for this project** (added to `heartbeat.allow`, an MCP tool as its whole server, then a run starts) · **Skip it, go on** |
| the folder not trusted in Claude Code | **Trust this folder** (what Claude Code's dialog records, for that folder only, then a run starts) |
| wrong branch, detached HEAD, a git operation half done | **Back to the main branch** (the operation aborted, the work kept on its branch) |
| a scheduled time that no longer exists | **Update the schedule** (`jerome heartbeat install`) |
| anything else | **Try again now**, and **Skip it, go on** where the work itself is stuck |

Only a provisional PROJECT.md and a folder with no git have no buttons: both happen once, when a project is made at the Mac. A block no run clears by itself reaches you at once (D173); one that may clear, such as a run stopped at its budget, when it lasts. A push, a deploy or a release the work needs comes as a decision request with the command to run (D174).

Each button carries only the alert's number and the action's name, from a list written in Jérôme (D167). The project checks that the alert is still open and offers that action; nothing is discarded, pushed, merged or deployed; no action runs while a heartbeat does ("try again when it ends"). The alert closes with who closed it and how (`telegram:commit`), and the buttons go from the message.

Nothing else is done: the bridge runs no shell and no other command, and passes your text only to `jerome request answer`, without a shell. An answer to a request already closed changes nothing, and says so. Messages from other chats, or from groups, are dropped unread and only counted in the watchdog's log.

## Notes

A note goes to the project's database, never to a file in the repository, so it never leaves the tree dirty under a heartbeat (D133). The next heartbeat's triage reads the open notes, quoted, and may choose its task from them; the lead agent gets them in its prompt, and your next session at its start. They are your words, with the weight of an entry of `open.md`: never commands to run, and they lift none of the project's limits, so a note cannot make a heartbeat push or deploy. The lead agent records what a note means in `open.md` or `decisions.md` and closes it with `jerome note done <id>`. `jerome state` lists the open ones; [`jerome note list`](commands/note.md) shows them in full.

## Turning it off

`jerome telegram off` stops the listener and deletes the token and the queue. The watchdog keeps watching for lost runs and missed starts; `jerome watchdog uninstall` removes it.
