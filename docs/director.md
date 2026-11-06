# Jérôme Director

Jérôme Director is the coordinator of every Mac that runs Jérôme with the same Claude account. It runs on a server of yours, with Docker, and the Macs reach it over your VPN. This is phase 2 of the [quota governor](quota-governor.md). The design is in the [spec](specs/director.md) and the decisions are D145-D155. How the Macs, the Director and Telegram are connected, in pictures: [Jérôme in diagrams](diagrams.md#several-macs).

It is built in five steps:

| Step | What it does | |
|---|---|---|
| 1 | **Sees:** Macs connect and are approved; every minute each one sends what it knows | in place, 0.5.0 |
| 2 | **Shows:** a dashboard, also on the iPhone, in your language | in place, 0.5.1; simpler in 0.8.0; each project's [board](board.md) and a legend in 0.11.0; a **?** button with help, the legend and the guides in 0.12.3; answers, notes and a block's buttons in 0.13.0; the notes the runs wrote, to read, in 0.21.0 |
| 3 | **Decides:** permits for fill runs, slots that queue, a fallback when it cannot be reached | in place, 0.19.0, once turned on with `jerome director settings on`; see [Deciding](#deciding) |
| 4 | Setup on your server, step by step | in place: the Dockerfile and compose.yaml in 0.5.0, with Coolify since 2026-10-28; see [Setting it up](#setting-it-up) |
| 5 | Telegram on the Director, one bot for every Mac | in place, 0.20.0, once set up with `jerome director telegram setup`; see [Telegram](telegram.md#on-the-director-for-every-mac) |

Until you turn on step 3 with `jerome director settings on`, each Mac keeps working as in phase 1: run the [quota governor](quota-governor.md) on one Mac only.

## Security

The Director is built so that nobody can intercept the subscription's tokens or reach your Macs through it (D139):

- **What a Mac sends:**
  - the quota as percentages and reset times;
  - its projects' state: name, slots, open alerts and requests as short texts, usage, last heartbeat;
  - its finished runs;
  - each project's board (D177): what it does now and with which agents, its open items, its recent work, its closed items and parked ideas, as short texts in plain words. It goes when it changes, and every half hour.

  Never the subscription's token or any credential, code, prompts, transcripts, file paths or file contents. Every text is scrubbed before it leaves: an absolute path becomes `…/` and its last name.
- **The Director never contacts a Mac.** It only answers, and nothing listens on the Macs.
- **Any VPN, or none.** It listens on one address, your server's VPN address (Tailscale, WireGuard, any other), and refuses a public one. In Docker, the port is published on that address only.
- **Signed both ways.** Each Mac signs its requests with an Ed25519 key that never leaves it. The Director signs its answers, and each Mac checks them against the Director key it pinned when it connected. A VPN set up wrong still lets nobody pass for a Mac or for the Director.
- **What it refuses:**
  - a request replayed, or more than 5 minutes off the Director's clock;
  - one from a Mac it does not know, one waiting for approval, or one revoked;
  - a body with a field it does not know, or over 256 KB.
- **You approve each Mac** on the server, by a code the Mac shows, and you can revoke it.

## Setting it up

You need a server with Docker that is on your VPN, and the server's VPN address.

1. **On the server.**
   - **With Coolify:**
     - Add the repository as a resource, with the **Docker Compose** build pack, base directory `/` and compose file `/director/compose.yaml`.
     - Set the variable `DIRECTOR_ADDRESS` to the server's VPN address.
     - Give the service **no domain**: a domain would publish it on the internet through Coolify's proxy.
     - Deploy, then run `jerome director init` in the container's terminal.
   - **By hand:**
     - Clone the repository.
     - Write a `.env` file at its root holding `DIRECTOR_ADDRESS=100.101.102.103`.
     - From its root, run `docker compose --project-directory . -f director/compose.yaml up -d`, then `jerome director init` in the container.
   - `init` prints the address the Macs connect to and the Director's fingerprint. Keep both at hand.
2. **On each Mac:**
   - Connect it:
     ```sh
     jerome connect http://100.101.102.103:7788
     ```
   - Compare the fingerprint it shows with the one `init` printed, then answer `y`.
   - It shows this Mac's code. Approve it on the server:
     ```sh
     docker compose exec director jerome director approve <code>
     ```
   - The [watchdog](commands/watchdog.md) sends the first beat within a minute. `jerome connect status` shows it.
   - After you answer a question, send a note or tap a block's button on Telegram, the bridge sends a beat at once, so the dashboard shows it at its next refresh rather than a minute later (D193).

3. **The dashboard.** Run `jerome director dashboard` on the server: it prints the dashboard's address, with its token after the `#`. Open it from any device on your VPN, such as the iPhone, and keep it as a bookmark.
   - It speaks your language, the one of your Macs (`jerome language`), and says first, in one sentence, whether anything waits for you (D163). Then **what you need to do**: the open decision requests with their options, the blocks that have lasted (three runs or six hours) as one sentence each with how long, and a Mac not heard from for 15 minutes. Then **the projects**, one line each with its state in words (working, stopped and needing you, trying again by itself, waiting for your answer, waiting for its next turn), its last work and its turns. Then **the quota** of the week in one line, what Jérôme does with it, and its curve against the pace and the reserve. The Macs, the runs and the past weeks are under **details**, closed. Times are in the device's own time zone. It refreshes every 30 seconds.
   - **You can act from it, as on Telegram** (D169, D191): tap an option of a question, or write your own answer; clear a block with one of its buttons; send a project a note, from the box under it. See [acting from the dashboard](#acting-from-the-dashboard).
   - Its data come only with the token, which the browser never sends in the address: the page passes it in a header.
   - **As an app:** on the iPhone, in Safari, Share → Add to Home Screen; on the Mac, in Safari, File → Add to Dock. It opens with its own icon, the token kept in the saved address.
   - Whoever has the address sees everything the Director knows. If it leaks, `jerome director dashboard --new-token` makes the old one stop working.

## Deciding

Off after an update, so nothing changes until you choose it (D201). On the server:

```sh
jerome director settings on                 # the Director decides, from the next beat of each Mac
jerome director settings --reserve 25       # the pace it keeps: --target, --reserve, --five-hour-cap
jerome director settings off                # back to phase 1 on each Mac
```

Once on (D148, D149), the Director is the one governor of every Mac, and the local `jerome governor on` settings are not used. The projects offered for fill runs stay those given with `jerome governor add` on their Mac.

- **The pace** is the same as on one Mac: the freshest reading any Mac sent, the Director's target, reserve and 5-hour cap.
- **Fill runs:** at each beat, while the week is behind its pace, the Director gives at most one permit, at least 5 minutes after the last one on any Mac and on a reading taken since. It goes to the project whose last heartbeat is oldest, on any Mac that beat in the last 5 minutes, skipping a project that is running, has an open block, is at its own limit, or had a heartbeat or a fill run in the last 30 minutes. The model is the project's own, or Sonnet while that model's weekly limit is ahead of its pace.
- **Slots** still fire on their Mac at their time, and first ask the Director. At the 5-hour cap, at the reserve, or with another run holding the project, the run ends as queued, with no alert, and the Director grants it at a later beat as soon as there is room, before any fill run; a slot still queued after 6 hours is dropped. A slot the Director has not heard of yet just runs.
- **A permit** carries only its id, the project, the kind (and the slot), the model, the longest run and when it expires. The Mac drops one that names another Mac's project or a slot it does not have, a model other than Opus, Sonnet, Haiku or the project's own, a run longer than the project's, an expired one, or one with any other field, and a fill run when its own checks say no (a slot due before it could end, a session in use). It runs a permit as it runs its own work, under its own limits and rules.
- **A Mac that goes off** frees its place: a permit not started within 3 minutes lapses, and one started lapses at its longest run plus 10 minutes.
- **When the Director is silent** for 5 minutes, the Mac goes back to local mode at a reduced pace, said once in the watchdog's log: its slots run, held at the 5-hour cap and the reserve, and it starts a fill run of its own at most every 2 hours, with the Director's last settings. At the first answer it is directed again.

`jerome director status` shows the pace, the permits going and the queued slots; `jerome connect status` on a Mac shows whether it is directed or on its own; the dashboard shows each Mac's mode and, under details, what the Director decides.

## The dashboard

At the top, what waits for you. Then, side by side, the **network** and the **week's quota**. The network is drawn from the Macs' beats at every refresh: the Director, with its Telegram bot when it has one, and each Mac with its projects inside, linked by a wire in the colour of its state (green directed, yellow on its own, dashed red silent, dashed grey waiting for approval), on which a dash flows while the Mac beats. Each project has a dot for its state; tap it to reach its card. Below, a **card for each project**: its state, its last work, its turns, what is unlocked, its board and a box for a note, those that need you first. With several Macs, filter the cards by state or group them by Mac. On a phone everything is one column, and the Macs hang from a line under the Director (D203).

## Acting from the dashboard

What you send from the dashboard is an **order**, and an order is data, never a command (D169, D191):

1. The Director checks it against what the Mac last said: the project is the Mac's, the question or the block is open, the option is one of the question's, the action one the block offers, the push the one asked, the group to lock one that is unlocked, a text at most 2,000 characters. Then it only keeps it. The same answer or action twice is one order, and at most 20 orders a minute are taken.
2. The Mac takes it in the answer to its next beat, within a minute, signed with the Director's key it pinned. The Director still never contacts a Mac.
3. The Mac checks it again under its own rules, and runs it with the same code as a tap or a reply on Telegram: an answer through `jerome request answer`, a note as a note of the project, an action from the closed list of D167, never while a heartbeat holds the project. An order older than 10 minutes lapses, and one given twice runs once.
4. It reports at once what it did. The dashboard shows it under **Sent from here**: waiting for the Mac, done, not done with the reason, or lapsed. A question answered from the dashboard leaves the page at once.
5. **The Mac tells you on Telegram** of each order it ran: "📋 From the Director's dashboard: R4 answered: B". With the bot on the Director (0.20.4 or later), the message asks "Was it you?" with two buttons (D206): **Yes, it was me** only takes the buttons off; **No, it was not me** gives the dashboard a new token at once, so the address used until then opens nothing on any device, and the bot sends you the new one. What was done stays done: check that project. With a Mac's own bridge, the message says instead to run `jerome director dashboard --new-token` on the server.

### The push and what is unlocked

In a project where you [unlocked the push](commands/rules.md), the push Jérôme asked on Telegram shows under **What you need to do** too, with its commits and the same two buttons, **Push main** and **Not now**: the first answer counts, from either side. A question the lead agent asked sooner starts with its reason, from a Director 0.17.0 on (D198). Under each project, a line lists what you unlocked there, each with a **Lock again** button (D196), which asks you to confirm first, since unlocking again is done only at the Mac (D207). Unlocking has no button: it is done only at a terminal on the Mac, so whoever took the dashboard cannot unlock anything.

A Mac sends these only to a Director at 0.16.0 or later, which says its version in the answer to the beat; an older Director keeps working without them.

Whoever took the dashboard could therefore answer, leave notes, press the blocks' buttons, push a main branch whose push you unlocked and Jérôme asked, and lock again what you unlocked. A text from the dashboard reaches the agents as your words, but as data: it lifts none of a project's limits (no push, deploy, publish or email, no credentials read), and the message on Telegram tells you it came.

The image is built from the repository. After an update: in Coolify, a deploy; by hand, `git pull` and the same `up -d` with `--build`. The Director's data, its keys included, live in the `director-data` volume.

## Commands

- [`jerome director`](commands/director.md), on the server.
- [`jerome connect`](commands/connect.md), on each Mac.
