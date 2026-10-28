# Jérôme Director

Jérôme Director is the coordinator of every Mac that runs Jérôme with the same Claude account. It runs on a server of yours, with Docker, and the Macs reach it over your VPN. This is phase 2 of the [quota governor](quota-governor.md). The design is in the [spec](specs/director.md) and the decisions are D145-D155.

It is built in five steps:

| Step | What it does | |
|---|---|---|
| 1 | **Sees:** Macs connect and are approved; every minute each one sends what it knows | in place, 0.5.0 |
| 2 | A read-only dashboard, also on the iPhone | to do |
| 3 | **Decides:** permits for fill runs, slots that queue, a fallback when it cannot be reached | to do |
| 4 | Setup on your server, step by step | to do |
| 5 | Telegram on the Director, one bot for every Mac | to do |

Until step 3, each Mac keeps working as in phase 1: run the [quota governor](quota-governor.md) on one Mac only.

## Security

The Director is built so that nobody can intercept the subscription's tokens or reach your Macs through it (D139):

- **What a Mac sends:**
  - the quota as percentages and reset times;
  - its projects' state: name, slots, open alerts and requests as short texts, usage, last heartbeat;
  - its finished runs.

  Never the subscription's token or any credential, code, prompts, transcripts, file paths or file contents.
- **The Director never contacts a Mac.** It only answers, and nothing listens on the Macs.
- **Any VPN, or none.** It listens on one address, your server's VPN address (Tailscale, WireGuard, any other), and refuses a public one. In Docker, the port is published on that address only.
- **Signed both ways.** Each Mac signs its requests with an Ed25519 key that never leaves it. The Director signs its answers, and each Mac checks them against the Director key it pinned when it connected. A VPN set up wrong still lets nobody pass for a Mac or for the Director.
- **What it refuses:**
  - a request replayed, or more than 5 minutes off the Director's clock;
  - one from a Mac it does not know, one waiting for approval, or one revoked;
  - a body with a field it does not know, or over 64 KB.
- **You approve each Mac** on the server, by a code the Mac shows, and you can revoke it.

## Setting it up

You need a server with Docker that is on your VPN, and the server's VPN address.

1. **On the server,** in a folder of its own:
   - Copy `director/compose.yaml` from the repository.
   - Write a `.env` file next to it holding the server's VPN address:
     ```sh
     DIRECTOR_ADDRESS=100.101.102.103
     ```
   - Start it:
     ```sh
     docker compose up -d
     docker compose exec director jerome director init
     ```
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

The image is built from the repository on GitHub. After an update, `docker compose build --pull && docker compose up -d`. The Director's data, its keys included, live in the `director-data` volume.

## Commands

- [`jerome director`](commands/director.md), on the server.
- [`jerome connect`](commands/connect.md), on each Mac.
