# `jerome telegram`

The Telegram bridge of this machine: see [telegram.md](../telegram.md).

```sh
jerome telegram setup    # connect a bot and your chat, install the watchdog that runs it
jerome telegram status   # the bot, the chat heard, the messages waiting to be sent
jerome telegram test     # send a test message
jerome telegram off      # delete the token and the queue
```

`setup` reads the token from standard input without echoing it, checks it with Telegram, waits up to 2 minutes for your `/start`, and asks you to confirm the chat. It then runs [`jerome watchdog install`](watchdog.md).

| Code | Meaning |
|---|---|
| 0 | done |
| 1 | Telegram refused the token, no message came, you did not confirm the chat, or the bridge is not set up (`test`) |
| 2 | not a bot token, or wrong usage |
