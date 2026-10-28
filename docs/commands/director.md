# `jerome director`

[Jérôme Director](../director.md), on the server (D145-D154). With Docker, run each command as `docker compose exec director jerome director …`.

```sh
jerome director init [--listen <address>[:port]]   # set it up, or change its address; prints the address and the fingerprint
jerome director serve [--listen <address>[:port]]  # the service itself (what the container runs)
jerome director status                             # running or not, the Macs, the latest quota reading
jerome director machines                           # every Mac: name, code, status, last beat, projects
jerome director approve <code>                     # let a Mac in, by the code `jerome connect` showed on it
jerome director revoke <mac>                       # by name or code: refused from then on
```

- **`--listen`** takes the server's address on your VPN, such as `100.101.102.103` or `10.0.0.1:7788`. The port is 7788 by default.
  - It refuses `0.0.0.0`, `::` and public addresses.
  - It accepts loopback, 10/8, 172.16/12, 192.168/16, 100.64/10 and fc00::/7.
  - In the container the Director listens on all of the container's interfaces. It starts only when `DIRECTOR_ADDRESS`, the address compose publishes the port on, is a private one.
- **`init`** makes the Director's keys once and keeps them in `$XDG_DATA_HOME/jerome-director/` (700; the keys file 600; `/data` in the container). Run again, it only prints the setup, or changes the address.
- **Its log** is the standard output (`docker compose logs director`). It gets a line when a Mac asks to connect, and when a request is refused, with the reason.
- **A Mac that connects again** with a new key replaces its own request that was still waiting. Requests not approved within a day are dropped, and at most 5 wait at a time.
