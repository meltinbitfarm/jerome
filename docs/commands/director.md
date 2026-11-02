# `jerome director`

[Jérôme Director](../director.md), on the server (D145-D154). With Docker, run each command as `docker compose exec director jerome director …`.

```sh
jerome director init [--listen <address>[:port]]   # set it up, or change its address; prints the address and the fingerprint
jerome director serve [--listen <address>[:port]]  # the service itself (what the container runs)
jerome director status                             # running or not, the Macs, the latest quota reading
jerome director machines                           # every Mac: name, code, status, last beat, projects
jerome director approve <code>                     # let a Mac in, by the code `jerome connect` showed on it
jerome director revoke <mac>                       # by name or code: refused from then on
jerome director dashboard [--new-token]            # the dashboard's address with its token; a new token voids the old address
jerome director settings [on | off] [--target <n>] [--reserve <n>] [--five-hour-cap <n>]
                                                   # whether the Director decides the Macs' fill runs and slots, and its pace
jerome director telegram setup | status | test | off
                                                   # the Telegram bot on the Director, for every Mac's projects
```

- **`--listen`** takes the server's address on your VPN, such as `100.101.102.103` or `10.0.0.1:7788`. The port is 7788 by default.
  - It refuses `0.0.0.0`, `::` and public addresses.
  - It accepts loopback, 10/8, 172.16/12, 192.168/16, 100.64/10 and fc00::/7.
  - In the container the Director listens on all of the container's interfaces. It starts only when `DIRECTOR_ADDRESS`, the address compose publishes the port on, is a private one.
- **`init`** makes the Director's keys once and keeps them in `$XDG_DATA_HOME/jerome-director/` (700; the keys file 600; `/data` in the container). Run again, it only prints the setup, or changes the address.
- **`dashboard`** prints `http://<address>/#<token>`, to open on any device on the VPN ([Jérôme Director](../director.md), step 2). A Director set up before 0.5.1 gets its token the first time it starts again or runs this.
- **`settings`** (D201): off by default, so a Director just updated changes nothing. `on` makes it [decide](../director.md#deciding) from each Mac's next beat; `off` gives each Mac back its phase 1. The options set the pace it keeps, as `jerome governor on` does on one Mac: `--target` (90), `--reserve` (20), `--five-hour-cap` (90). Run alone, it prints them.
- **`telegram`** (D202): `setup` connects a bot and your chat, as `jerome telegram setup` does on a Mac, and keeps its token in the data folder (600). At their next beat the Macs send their messages with the beat and keep their own bridges off; `off` deletes the token, and the Macs' bridges speak again. See [Telegram on the Director](../telegram.md#on-the-director-for-every-mac).
- **`status`** also shows, once it decides, the pace, the permits going and the queued slots.
- **Its log** is the standard output (`docker compose logs director`). It gets a line when a Mac asks to connect, when a request is refused, with the reason, and for each permit it gives, slot it queues or slot it drops.
- **A Mac that connects again** with a new key replaces its own request that was still waiting. Requests not approved within a day are dropped, and at most 5 wait at a time.
