# Limits and pauses

The subscription is shared by every project. Jérôme keeps scheduled work within two kinds of limits, and never blocks your own sessions.

## Global limits

They are percentages of the subscription's two windows, the 5-hour and the 7-day one, as Claude Code reports them (see [usage-data.md](usage-data.md)). They live in `~/.config/jerome/account.json`, with the latest reading of each window, written by the status line, by heartbeats and by their triage. A reading whose window has reset since is out of date: the status line leaves that window out, `jerome state`, `jerome limits` and the viewer say `no reading since its reset`, and no limit check uses it, until a new reading comes. Suggested values: **70% for 5 hours, 75% for 7 days**, so scheduled runs leave you 30% of the short window for your own work and never use the last quarter of the week.

## Project limits

They are in **API-equivalent dollars**, per calendar day (from local midnight) and per calendar week (from Monday 00:00). Tokens are a poor measure of quota: on a real project 94% of the tokens were cache reads, which cost a tenth of an input token, so 4.6 million tokens in a day came to $3.09 at API prices. Dollars are always shown with the tokens beside them. Every use of the project counts, interactive sessions included, since the quota is one. Limits are per project, not per [area](areas.md).

Defaults: **$5 a day, $20 a week.** A project's heaviest day so far was $3.09, during intense development, while a heartbeat that does real work costs about $0.25 to $0.65: an hourly heartbeat that works every time stops after 8 to 20 runs in a day. Set them per project with [`jerome limits`](commands/limits.md).

## Pauses

A heartbeat checks the limits after its other checks and before any token is spent. If a window is at or over its limit, it stops with the reason, for example:

```
blocked: project limit: today ≈$5.12 / $5 API (7.1M tokens), resets at midnight
```

A pause is not stored anywhere: the first heartbeat after the window resets (midnight, Monday, or the subscription window's reset time) goes ahead by itself. You get one macOS notification per pause, not one per heartbeat. `jerome state` shows a `paused` line while it lasts, and the viewer shows the limits in red.

## Interactive sessions

They are never blocked. When a limit is at 90% or more, the session starts with a warning for you, which costs the model nothing:

```
SessionStart:startup says: Jérôme: usage near or over its limits: project today ≈$3.36/$0.10 · this week ≈$4.22/$20 API. Heartbeats pause at a limit; this session is not blocked.
```

The status line shows each window and the project's day against their limits, coloured like the viewer: green, yellow from 75% of the limit, red from 90%, bold red beyond it.

```
5h 57%/70% · 7d 22%/75% · today ≈$3.36/$5 API
```
