# `jerome language`

The language Jérôme writes to you in (D162): the notifications, the Telegram bridge, the warning when the quota runs fast, and the decision requests the lead agent opens in heartbeats. The repository's files, the digest, the commits and the docs stay in English.

```sh
jerome language          # the language used, and where it comes from
jerome language it       # Italian
jerome language en       # English
jerome language auto     # back to the system's
```

The language is, in order: the one set with this command (in `~/.config/jerome/preferences.json`, on this Mac), the system's (macOS's first preferred language in System Settings → General → Language & Region, `LANG` elsewhere), English. A Mac whose system is in English with the region set to Italy writes in English until you run `jerome language it`.

Set it on the Mac that runs the [Telegram bridge](../telegram.md) and the heartbeats: that is where the messages are written. Available today: `en`, `it`.
