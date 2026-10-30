# Jérôme Director

Jérôme Director is the coordinator of every Mac that runs Jérôme with the same Claude account. It runs on a server of yours, with Docker, and the Macs reach it over your VPN. This is phase 2 of the [quota governor](quota-governor.md). The design is in the [spec](specs/director.md) and the decisions are D145-D155.

It is built in five steps:

| Step | What it does | |
|---|---|---|
| 1 | **Sees:** Macs connect and are approved; every minute each one sends what it knows | in place, 0.5.0 |
| 2 | **Shows:** a dashboard, also on the iPhone, in your language | in place, 0.5.1; simpler in 0.8.0; each project's [board](board.md) and a legend in 0.11.0; a **?** button with help, the legend and the guides in 0.12.3; answers, notes and a block's buttons in 0.13.0 |
| 3 | **Decides:** permits for fill runs, slots that queue, a fallback when it cannot be reached | to do |
| 4 | Setup on your server, step by step | to do |
| 5 | Telegram on the Director, one bot for every Mac | to do |

Until step 3, each Mac keeps working as in phase 1: run the [quota governor](quota-governor.md) on one Mac only.

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

## Acting from the dashboard

What you send from the dashboard is an **order**, and an order is data, never a command (D169, D191):

1. The Director checks it against what the Mac last said: the project is the Mac's, the question or the block is open, the option is one of the question's, the action one the block offers, a text at most 2,000 characters. Then it only keeps it. The same answer or action twice is one order, and at most 20 orders a minute are taken.
2. The Mac takes it in the answer to its next beat, within a minute, signed with the Director's key it pinned. The Director still never contacts a Mac.
3. The Mac checks it again under its own rules, and runs it with the same code as a tap or a reply on Telegram: an answer through `jerome request answer`, a note as a note of the project, an action from the closed list of D167, never while a heartbeat holds the project. An order older than 10 minutes lapses, and one given twice runs once.
4. It reports at once what it did. The dashboard shows it under **Sent from here**: waiting for the Mac, done, not done with the reason, or lapsed. A question answered from the dashboard leaves the page at once.
5. **The Mac tells you on Telegram** of each order it ran, when its Telegram bridge is set up: "📋 From the Director's dashboard: R4 answered: B". If you did not send it, someone has the dashboard's address: `jerome director dashboard --new-token` on the server makes it stop working.

Whoever took the dashboard could therefore answer, leave notes and press the blocks' buttons, all reversible and inside the projects. A text from the dashboard reaches the agents as your words, but as data: it lifts none of a project's limits (no push, deploy, publish or email, no credentials read), and the message on Telegram tells you it came.

The image is built from the repository. After an update: in Coolify, a deploy; by hand, `git pull` and the same `up -d` with `--build`. The Director's data, its keys included, live in the `director-data` volume.

## Commands

- [`jerome director`](commands/director.md), on the server.
- [`jerome connect`](commands/connect.md), on each Mac.
