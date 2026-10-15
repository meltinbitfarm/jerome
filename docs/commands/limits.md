# `jerome limits [dir]`

Shows and sets the usage limits. Heartbeats pause when a limit is reached and start again by themselves when its window resets. Interactive sessions are never blocked: you are warned instead (see [limits](../limits.md)).

```
$ jerome limits
global  5h 59% / 70%
global  7d 22% / 75%
        in ~/.config/jerome/account.json
project today ≈$3.35 API (4.8M tokens) / $5
project week  ≈$4.22 API (5.8M tokens) / $20
```

| Option | Sets |
|---|---|
| `--five-hour <n\|off>` | the global limit on the subscription's 5-hour window, in % |
| `--seven-day <n\|off>` | the global limit on the 7-day window, in % |
| `--daily <usd\|off\|default>` | the project's limit per calendar day, from local midnight, in API-equivalent dollars |
| `--weekly <usd\|off\|default>` | the project's limit per calendar week, from Monday 00:00 |

Global limits are saved in `~/.config/jerome/account.json` and apply to every project. Project limits are saved in the project's `.jerome/project.json`; without them the defaults apply, $5 a day and $20 a week. `off` turns a limit off, `default` goes back to the default.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Shown, or set and shown |
| 1 | A project option outside a Jérôme project |
| 2 | Wrong usage, such as a percentage over 100 |
