# `jerome rules`

What Jérôme blocks for the lead agent and its agents in a project, and what you unlocked there (D194).

```sh
jerome rules                 # the list, for the project in this folder
jerome rules unlock push     # unlock one, at a terminal on this Mac
jerome rules lock push       # lock it again
```

By default every group is locked: pushing, merging or releasing on GitHub, publishing packages or images, deploying, sending email. The commands of each group are deny rules of the project's `.claude/settings.json`, listed in [agents.md](../agents.md#binding-limits).

## Unlocking the push

`jerome rules unlock push` asks you to type the project's name, and works only at a terminal: a command the model runs has none, and Jérôme refuses it to the model in any session as well. The choice is kept on this Mac, in the project's store, not in the repository, so no run can change it with a commit. The lead agent is told with a note, which it records as a decision.

Unlocked, the push is still not the model's: its `git push` stays denied. Instead:

1. Once the main branch has commits not pushed, and no run is working in the project, Jérôme asks you on Telegram: how many commits, the first lines of each, and two buttons, **Push main** and **Not now**. After a push by a button, the next question says its commits are new since that push, with its time, so it does not read as the same push again (D197).
2. **Push main** pushes that branch, and only it, to its own remote, never with force, if it has not changed since the question. Its commits are what the lead agent merged after the tests passed, and what you committed yourself. The push may start a deploy, if the project has one.
3. **Not now** is not asked again until the branch has new commits. A question whose branch has changed loses its buttons, and a new one comes with the new commits.

A push that fails, for example because the remote has commits this Mac has not, is told on Telegram with git's reason, and its buttons stay for another try. The push uses this Mac's own git credentials, the ones of the watchdog's session.

`jerome rules lock push` stops the questions; the lead agent goes back to asking you to push.

The same question, with the same buttons, shows on the [Director's dashboard](../director.md#the-push-and-what-is-unlocked) when the Mac is connected to one.

## Unlocking the others

Any other group, such as `deploy-fly` or `publish`, is unlocked the same way, at a terminal with the project's name typed, and while no run is working, on the main branch, with `.claude/settings.json` not changed by you. Its rules move from deny to ask in that file, which is committed on the main branch by itself. Then:

- **In your sessions**, the lead agent may run those commands, and Claude Code asks you each time, with the command in full: you say yes or no there.
- **In heartbeats**, nobody is there to answer, so they stay refused: the hook says why, and the lead agent opens a decision request instead, as before.

`jerome doctor` keeps them so, and the lead agent is told with a note, which it records as a decision. `jerome rules lock <name>` moves them back to deny, committed the same way.

## Where you see them

`jerome view` lists what is unlocked in the project, and the push asked. The [Director's dashboard](../director.md#the-push-and-what-is-unlocked) shows them under each project, each with a **Lock again** button: locking again is the safe way, so it can be done from afar; unlocking only here.
