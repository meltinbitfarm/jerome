# `jerome request`

Opens and closes decision requests: what the lead agent leaves when it needs you and nobody is reading, in a heartbeat. The lead agent runs these commands, from the project folder; they are among the project's allowed commands.

```sh
jerome request open --question "Tests fail on task/x: merge anyway?" --options "merge / fix first" --recommendation "fix first"
jerome request answer 3 "Fix the tests first"
jerome request drop 3
```

`open` prints the request's id, as `R3`. The same question already open is not opened twice. `answer` and `drop` take the id with or without the `R`. Open requests show in `jerome state`, `jerome view`, and at the start of an interactive session. See [heartbeat.md](../heartbeat.md#decision-requests).

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | Not a Jérôme project, no database, no such request, or a request already closed |
| 2 | Wrong usage |
