# `jerome quota`

The subscription's windows as Claude Code's usage endpoint gives them now, and the [quota governor](../quota-governor.md)'s verdict (D140). It asks the endpoint every time and records the reading in `~/.config/jerome/account.json`. It works with the governor off too.

```
$ jerome quota
quota    5h 14% (resets 2026-10-28 17:59) · 7d 6% (resets 2026-11-04 02:59) · read 0 min ago from the usage endpoint
         Fable 0% of its weekly limit · this week Claude Code 38%, Chats 62%
pace     target now 6.4% · ceiling 80% · go: 7d 6% behind its pace, 6.4%
```

- **`quota`:** each window with its reset, in local time, and where the reading came from.
- **The second line:** the weekly limits scoped to one model, and the week's share by surface.
- **`pace`:** where the week should be now, the ceiling that the reserve leaves, and the verdict:
  - `go`: behind the pace, in the last 24 hours, or a 5-hour burst;
  - `hold`: ahead of the pace, at the 5-hour cap, or at the reserve;
  - `reduced`: no fresh reading.

`--json` prints the windows, the reading, the pace and the governor's settings (schema `jerome.quota/v1`). The exit code is 1 when the endpoint could not be read; the last reading is shown anyway, with the error.

The login token used for the call is never printed, stored or logged.
