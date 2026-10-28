# `jerome connect`

Connects this Mac to [Jérôme Director](../director.md) (D146-D152).

```sh
jerome connect <address> [--name <name>]   # e.g. http://100.101.102.103:7788; the name defaults to the Mac's
jerome connect status                      # the Director, this Mac's code, approved or not, the last beat
jerome disconnect                          # forget the Director and this Mac's key
```

**What `connect` does:**
1. It makes this Mac's Ed25519 key. The private key stays in `~/.config/jerome/director.json`, readable by you only.
2. It says hello to the Director.
3. It shows the Director's fingerprint, which must match the one `jerome director init` printed on the server. Answer `y` only if it does. A different fingerprint means you are not talking to your Director, and nothing is kept.
4. It shows this Mac's code, to approve on the server with `jerome director approve <code>`.

**After that, the [watchdog](watchdog.md) sends a signed beat every minute.**
- **What it holds:**
  - the quota, read at most every 5 minutes;
  - this Mac's projects;
  - the heartbeats that ended since the last beat.
- **It never holds:** a credential, code, prompts, transcripts or file paths.
- **Answers:** any answer not signed with the Director's pinned key is ignored.
- **The log:** the watchdog's log gets a line only when the outcome changes, such as waiting for approval, answered, or not reachable.

Until step 3 of the Director, connecting changes nothing in how this Mac works: the [quota governor](../quota-governor.md), if on, keeps deciding here.

`jerome disconnect` deletes the key on this Mac. On the server, `jerome director revoke <name>` removes the Mac there.
