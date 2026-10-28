# Telegram

Jérôme can reach you on Telegram, for every project on a machine, and you can answer from there (D130-D134). It is a bridge, not a chat with the lead agent: no model reads your messages there, and it costs no tokens.

## Setting it up

1. In Telegram, create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`), and copy its token.
2. On the machine where your projects run:

   ```sh
   jerome telegram setup
   ```

   Paste the token (it is not echoed), then send `/start` to your bot from your own Telegram account. Jérôme shows who the message came from and asks you to confirm: from then on, only that private chat is heard. It installs the [watchdog](commands/watchdog.md), the machine's job that runs the bridge every minute, and sends you a test message.

The token is kept in `~/.config/jerome/telegram.json`, readable by you only (`600`, in a `700` folder), never in a project or a log; `jerome doctor` warns if others can read it. The bridge asks Telegram for new messages every minute (`getUpdates`): nothing on the machine listens on the internet.

## What you get

Everything that waits for you, from every project, with its name first:

- [alerts](heartbeat.md#alerts), and their reminders every 3 hours while they stay open;
- decision requests, opened by a heartbeat or in a session, with their options as buttons;
- heartbeats that could not start (a project to move to `.jerome/`, a missing database), [missed starts](heartbeat.md#missed-starts) and [lost runs](heartbeat.md#lost-runs);
- a failed heartbeat, and a limit pause (once per pause).

The macOS notifications stay, and `heartbeat.alerts.command` stays for other channels. A message Telegram refuses is retried every minute for 2 days.

## What you can send

| You send | What happens |
|---|---|
| a tap on an option of a request | the request is answered with that option, through `jerome request answer` in its project |
| a reply to a request's message | the request is answered with your text |
| a reply to any other message of a project | your text becomes a note for that project |
| `#project text` | a note for that project |
| any other text | a note: for the only project, or Jérôme asks which one, with a button each |
| `/status` | what waits for you in every project, from `jerome projects` |
| `/help` | what you can send |

Nothing else is done: the bridge runs no shell and no other command, and passes your text only to `jerome request answer`, without a shell. An answer to a request already closed changes nothing, and says so. Messages from other chats, or from groups, are dropped unread and only counted in the watchdog's log.

## Notes

A note goes to the project's database, never to a file in the repository, so it never leaves the tree dirty under a heartbeat (D133). The next heartbeat's triage reads the open notes, quoted, and may choose its task from them; the lead agent gets them in its prompt, and your next session at its start. They are your words, with the weight of an entry of `open.md`: never commands to run, and they lift none of the project's limits, so a note cannot make a heartbeat push or deploy. The lead agent records what a note means in `open.md` or `decisions.md` and closes it with `jerome note done <id>`. `jerome state` lists the open ones; [`jerome note list`](commands/note.md) shows them in full.

## Turning it off

`jerome telegram off` deletes the token and the queue. The watchdog keeps watching for lost runs and missed starts; `jerome watchdog uninstall` removes it.
