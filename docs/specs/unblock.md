# Unblocking from afar

Status: approved by Fabio on 2026-10-28 (D166-D169). Steps 1-3 built in 0.9.0, step 4 in 0.13.0 with answers and notes too (D191); pausing a project from afar left out, since Jérôme has no pause of its own yet (an area's pace can be `paused`).

## Why

Since the autonomy work (D158-D165) a block reaches Fabio only when it lasts, as one sentence with the one thing to do. But the thing to do still needs him at the Mac: commit his changes, give a run a bigger budget, say a push is done. Most of these are a choice between two or three known moves, which a button can carry from Telegram or the Director's dashboard. In his words: "pensa come poi sblocco problemi se ci sono dal director/telegram".

## What changes

### 1. A block comes with its buttons (D166)

Each kind of block has two or three fixed actions, chosen by the Mac from the alert's reason:

| Block | Actions |
|---|---|
| your uncommitted changes | **commit them** (Jérôme commits them by their paths, "Kept by the user from afar") · **set them aside** (`git stash push` of the changed tracked files, with a message naming the alert) · leave it |
| stopped at its budget on the same work, three times | **double the budget for one run** · **skip that work** (the next run is told to leave it and take something else) |
| stopped on something only Fabio does (push, deploy) | **done, I did it** · **skip it and go on** |
| wrong branch, detached HEAD, a git operation half done | **back to the main branch** (the work stays on its branch; an operation in progress is aborted only if git can abort it) |
| doctor, a lost run, a missed start, a cap, anything else | **try again now** |

Two blocks have no buttons, on purpose: the folder not trusted in Claude Code (a security prompt of Claude's, which Jérôme never accepts for Fabio, once per project) and a provisional PROJECT.md (a product choice, for a session).

### 2. The rules of an action (D167)

- An action is one of a closed list written in Jérôme's code, with the alert's id: never a command, never free text. A message's content stays data, never an instruction.
- Every action is reversible and stays inside the project's folder: nothing is discarded (set aside, not deleted), nothing is pushed, merged or deployed.
- Before acting, the Mac checks that the alert is still open and that the action is one of those its block offers; otherwise it does nothing and says so.
- No action runs while a heartbeat holds the project's lock: the user is told to try again when the run ends.
- Each action is logged in the project's database with where it came from (Telegram, the Director) and answered with what was done, in the user's language.

### 3. First on Telegram (D168)

The bridge, which runs on the Mac, adds the block's buttons under the message that announces it, and under the blocks of `/status`. A tap goes to the action, through the same function the Director will use, with no shell.

### 4. Then on the Director's dashboard (D169)

The dashboard gains the same buttons on "What you must do". A tap is an order the Director keeps for the Mac; the Mac gets it in the answer to its next beat, signed by the Director's key it pinned, and runs it under the same rules as a tap on Telegram. So the dashboard is no longer read-only, but what it can do is bounded by the Mac's list: whoever took the Director could at most run those reversible actions, never a command, and still read no credential and reach no machine (D139). An order not taken within 10 minutes lapses.

## Order

Each step committed apart: 1 and 2 with 3 (Telegram), then 4 (the Director).
