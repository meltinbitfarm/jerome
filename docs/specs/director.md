# Jérôme Director: spec (phase 2)

Status: approved by Fabio on 2026-10-28, with Telegram moved onto the Director (step 5). It follows [quota-governor.md](quota-governor.md), the brief of the quota governor, whose phase 1 (the governor on one Mac, D140-D144) is in place. The sections S1-S10 are recorded as decisions D145-D154, and Telegram on the Director as D155.

## Goal

One coordinator for every Mac that runs Jérôme with the same Claude account. It reads the account's real quota from the Macs, decides which runs start where, and shows what happens on every Mac in one page. The goal of the governor stays: each weekly reset at about 90% used, with room for Fabio's own work, and no Mac depending on another.

## Scope

- **In phase 2:** the coordinator, the Macs' connection to it, permits for fill runs and scheduled slots, the fallback when it cannot be reached, and a **read-only dashboard**. The dashboard was phase 3 in the brief; it moves here because a coordinator nobody can see into is a black box.
- **Also in phase 2, as its last step:** the Telegram bot, moved onto the Director (D155). It is one bot for every project of every Mac. Answers and notes reach the Macs as data in the beat's response, and the bot's token lives on the server (600). Until that step the bridge stays on the Mac Mini only: one bot can be polled by one machine only.
- **Left to phase 3:** approving a Mac from Telegram, and any action taken from the dashboard.
- **Out of scope**, as in the brief: several Claude accounts, and API billing.

## Constraints

- **C1:** any VPN, or none. The Director works on any network where the Macs can reach the server: Tailscale, WireGuard, another VPN, a local network. It never calls a VPN's software or API, and its security never relies on the VPN.
- **C2:** D139 in full. The subscription's token never leaves a Mac. The Director never reaches a Mac. What it sends is data, never a command, a prompt or a path. Each Mac is approved by Fabio, and each can be revoked.
- **C3:** Jérôme stays usable alone (brief V3, D15). Without `jerome connect`, a Mac works as in phase 1.
- **C4:** same package, no new dependency. The Director is `jerome director …` in the CLI already installed, on Node ≥ 24 with `node:http`, `node:crypto` and `node:sqlite`.
- **C5:** the server is Fabio's Ubuntu VPS, and the Director runs there with Docker Compose. The `Dockerfile` and `compose.yaml` are written by hand in the repository, on the official Node 24 image; no Nixpacks or any other build generator.

## Network (S1)

- **One address only.** `jerome director init --listen <address>:<port>` names the address the Director listens on: the server's VPN address (Tailscale's `100.x.y.z`, a WireGuard interface's `10.x.y.z`, …), port 7788 by default. It listens on that address and nowhere else.
- **No public address.** The Director refuses `0.0.0.0`, `::` and any public address. It accepts loopback, the private ranges (10/8, 172.16/12, 192.168/16), the shared range VPNs use (100.64/10), and IPv6 unique local addresses (fc00::/7). So it can never be put on the internet by mistake, with whatever VPN.
- **Plain HTTP inside the VPN.** The VPN encrypts the traffic. Identity and integrity do not rest on it: they come from the signatures of S2, so a VPN set up wrong exposes nothing that can be used.

## Identity and signatures (S2)

- **The Director's key.** `init` generates an Ed25519 key pair for the Director, kept in its data folder (600), and prints its fingerprint.
- **Each Mac's key.** `jerome connect` generates an Ed25519 key pair for the Mac. The private key and the Director's pinned public key go in `~/.config/jerome/director.json` (600, in a 700 folder), like the Telegram token. The private key never leaves the Mac.
- **Pinning the Director.** `jerome connect` shows the Director's fingerprint and asks Fabio to confirm that it matches the one `init` printed. From then on, every response must carry the Director's signature, or the Mac ignores it.
- **Approving the Mac.** `jerome connect` shows a short code: the fingerprint of the Mac's key, as 4 groups of 4 characters. Fabio approves it on the server with `jerome director approve <code>`, over SSH. A Mac not yet approved can only say hello; a revoked one gets nothing (`jerome director revoke <mac>`).
- **What every request carries:** the Mac's id, the time, a nonce, and a signature over the method, the path, the time, the nonce and the body's SHA-256.
- **What the Director refuses:**
  - a time more than 5 minutes off;
  - a nonce seen in the last 10 minutes;
  - an unknown, pending or revoked Mac;
  - a body over 64 KB, or with a field it does not know;
  - more than 20 requests a minute from one Mac.
- **What leaking the database gives an attacker:** if the server's database leaks, it holds public keys only. No one can pass for a Mac with them.

## What travels (S3)

From a Mac to the Director, nothing else:

- **The quota:** the windows' percentages and reset times, the scoped limits and the share by surface, when the Mac has read them since its last beat.
- **Its projects:**
  - their key (the registry key, not the path) and name (the folder's name);
  - their slots (name and times);
  - whether one is offered for fill runs (`jerome governor add`);
  - whether a run is going;
  - their open alerts and decision requests, as id and their short text;
  - whether they are at their own limit;
  - their last heartbeat (time, status, reason up to 200 characters);
  - their usage today and this week, in tokens and API dollars.
- **Its finished runs:**
  - project, kind (fill or slot), the permit they ran on, model;
  - start, end, status, reason (up to 200 characters);
  - the quota before and after (D143).

Never: the token or any credential, code, diffs, prompts, transcripts, file paths, the content of the project's files.

From the Director to a Mac, in a signed response:

- **Permits**, each with exactly these fields:
  - `id`;
  - `project` (a key);
  - `kind` (`fill` or `slot`), with `slot` (a name) for a slot;
  - `model`;
  - `maxMinutes`;
  - `expiresAt`.
- **The pace**, to show: its verdict, why, and the target.

**What the Mac checks before running a permit,** dropping it on any failure and logging why:

- the signature;
- that the project is one of its own, and the slot one of that project's;
- that the model is `opus`, `sonnet`, `haiku` or the project's `heartbeat.model`;
- that `maxMinutes` is at most the project's own;
- that the permit has not expired;
- that it has no other field.

A permit only lets the Mac run work it already has, the way it would run it alone: its checks, its limits, its allow rules.

## Beats and permits (S4)

- **The beat.** The watchdog, every 60 seconds, sends its beat (`POST /v1/beat`) and gets back the Mac's permits. That is the only regular traffic. The quota is still read at most every 5 minutes by each Mac (D140), and the Director uses the freshest reading from any Mac.
- **Fill runs (D144, across Macs).** At most one per project at a time. A new one starts at least 5 minutes after the last one on any Mac, and only on a reading taken since. The project with the oldest last heartbeat goes first, skipping projects:
  - that are busy;
  - that have an open alert;
  - that are at their own limit;
  - that started a heartbeat in the last 30 minutes.
- **Slots ask.** A slot's launchd job still fires on its Mac (the schedules stay where they are). Its run first asks the Director (`POST /v1/ask`, 10-second timeout):
  - With a go it runs.
  - Otherwise it ends as `queued`, raising no alert, and the Director grants the slot in a later beat as soon as there is room. The watchdog then starts it.
  - Slots come before fill runs.
  - A queued slot not granted within 6 hours is dropped and noted.
  - Slots are held only at the 5-hour cap and at the reserve, as in phase 1 (D142).
- **Permit lifetime.** A permit not started within 3 minutes lapses. One started lapses at its `maxMinutes` plus 10. So a Mac switched off mid-run frees its place for the others (brief D4). Each run reports its permit's id when it starts and when it ends.
- **The pace.** The settings (target, reserve, 5-hour cap) live on the Director (`jerome director settings`), and the pace is the same `pacing.js` as in phase 1.

## When the Director cannot be reached (S5)

With no valid signed response for 5 minutes, a Mac goes back to local mode, at a reduced pace (brief D11):

- its slots run, held at the 5-hour cap and the reserve;
- fill runs start only on a local go, and at most one every 2 hours.

It logs the switch, and the dashboard shows the Mac as unreachable since that time. At the first valid response it is directed again.

## Data on the Director (S6)

One SQLite database in `$XDG_DATA_HOME/jerome-director/` (700), with:

- **machines:** id, name, public key, status pending, approved or revoked, last beat, mode;
- **projects:** Mac, key, name, slots, state;
- **quota readings:** kept 90 days;
- **permits;**
- **runs:** the summary of S3, kept 90 days;
- **weekly results:** the 7-day window at each reset, kept forever;
- **settings.**

It is the least the brief's D13 allows: state, queues, usage, pending decisions.

## Dashboard (S7)

Read-only, served by the Director on the same address. Each request needs the dashboard token that `init` prints as a full URL, with the token in the fragment. `jerome director dashboard` prints it again, and `--new-token` replaces it. There are no write endpoints. As in the local viewer, a strict Content-Security-Policy applies and every text is set with `textContent`. The page refreshes every 30 seconds and fits a phone.

- **Quota:** the 7-day window on the week's curve, with the target line and the reserve, the 5-hour window, the scoped limits, the share Claude Code / chats, and the result of past weeks (% at each reset).
- **Macs:** connected or unreachable, mode (directed or local), last beat, runs going, permits and their expiry, queued slots.
- **Projects,** by Mac:
  - the state, the last heartbeat and its outcome;
  - open alerts and requests (their text);
  - usage today and this week;
  - the average cost of a run;
  - the fill runs done.
- **History:** runs and permits of the last weeks, filterable by Mac and project.

## Commands (S8)

On the server:

```sh
jerome director init --listen <address>[:port]   # data folder, Director key, dashboard URL
jerome director serve                              # the service itself
jerome director status                             # running, Macs, the pace
jerome director machines                           # Macs, pending ones with their code
jerome director approve <code> | revoke <mac>
jerome director settings [--target n] [--reserve n] [--five-hour-cap n]
jerome director dashboard [--new-token]
```

On each Mac:

```sh
jerome connect <url>       # pin the Director, show the Mac's code to approve, wait for it
jerome connect status      # directed or local, last response, permits going
jerome disconnect          # back to phase 1 on its own
```

Once connected, the local governor settings are not used. The projects offered for fill runs stay the ones given with `jerome governor add`.

## Setting it up (S9)

1. **On the VPS** (Ubuntu, Docker, on the VPN). Only `compose.yaml` and a `.env` file are needed: the image is built from the repository on GitHub.
   ```sh
   # .env
   DIRECTOR_ADDRESS=<the VPS's VPN address>
   ```
   ```sh
   docker compose up -d
   docker compose exec director jerome director init
   ```
   - **How the address rule (S1) holds in Docker:**
     - Inside the container the Director listens on the container's own interface.
     - Compose publishes it only on `DIRECTOR_ADDRESS`, never on all interfaces. That matters because Docker's published ports go around ufw.
     - The Director refuses to start when `DIRECTOR_ADDRESS` is missing or public.
   - **Where the data lives:** in a volume, its keys included.
   - **Note** the Director's fingerprint and the dashboard URL that `init` prints. Every other command runs the same way: `docker compose exec director jerome director approve <code>`.
2. **On each Mac:**
   - Run `jerome connect http://<VPN address>:7788` and confirm the fingerprint.
   - On the VPS, run `docker compose exec director jerome director approve <code>`.
   - Turn off the local governor (`jerome governor off`): connecting does it by itself.
3. **On the iPhone:** open the dashboard URL with the VPN on.

## Tests (S10)

The Director runs in the tests in the same process, on loopback. Two Macs are simulated, each with its own XDG folders.

- **Refused requests:** forged signatures, replays, times off, extra fields, unknown, pending and revoked Macs.
- **Refused permits:** a permit naming another Mac's project, a model not allowed, or a longer `maxMinutes`; an unsigned or wrongly signed response.
- **Permits and slots:**
  - fill runs spread over two Macs, staggered;
  - a Mac switched off freeing its place;
  - a slot queued and then granted;
  - the switch to local mode and back.
- **Addresses:** the refusal of public ones.
- **The dashboard:** without its token, and with texts that hold HTML.

## Steps

Each step can be used on its own and is committed apart:

1. **The Director sees.** `init`, `serve`, keys, hello, approval and revocation, the signed beat with quota and projects, the database. On the Mac: `connect`, `connect status`, `disconnect`, and the beat in the watchdog. Nothing is decided yet, and each Mac keeps phase 1.
2. **The dashboard**, read-only, on the data of step 1.
3. **The Director decides.** Permits for fill runs, slots that ask and queue, the local fallback, settings on the Director.
4. **On the VPS for real.** The `Dockerfile` and `compose.yaml`, the docs, and Fabio's server set up step by step.
5. **Telegram on the Director.** One bot for every Mac's projects; answers and notes go to the Macs in the beat's response, as data. The Macs' own bridges are turned off.

## Answered

- **Queued slots:** dropped after 6 hours.
- **The Telegram bridge:** on the Mac Mini only until step 5, which moves it onto the Director.
