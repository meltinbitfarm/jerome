# Jérôme in diagrams

Five pictures of how the pieces fit: what runs on one Mac, the steps of a heartbeat, how several Macs talk to [the Director](director.md), what happens when you tap a button on Telegram, and the path of a slot when the quota is full. Each one follows the light or dark theme of the page that shows it.

## One Mac

![On one Mac: launchd starts heartbeats, the watchdog runs every minute, the Telegram bridge links the database and your phone](assets/diagrams/one-mac.svg)

The heartbeat is the only piece that spends tokens. The watchdog closes runs whose process died, tells you about alerts that last, asks about the push and, with the [governor](quota-governor.md) on, starts fill runs when the week is behind its pace. The [Telegram bridge](telegram.md) runs nothing itself: an answer goes through `jerome request answer`, a note goes into the database. `jerome view` shows the same database in the browser.

## A heartbeat

![The seven steps of a heartbeat, and where each one can stop it](assets/diagrams/heartbeat.svg)

The first five steps cost almost nothing: most runs with no work stop before the lead agent starts. An alert reaches you only if it lasts (three runs in a row or six hours), except those no run can clear by itself, which arrive at once with their buttons. See [heartbeats](heartbeat.md).

## Several Macs

![Each Mac sends a signed beat to the Director inside the VPN; the Director never calls a Mac; the dashboard and the Telegram bot are on the Director](assets/diagrams/several-macs.svg)

The only regular traffic is the beat: every minute a Mac tells the Director what it knows (quota, projects, finished runs, messages for Telegram) and takes permits and orders from the signed answer. The Director sends data, never commands, and the Mac checks them against its own rules before acting. If the Director is silent for 5 minutes, the Mac goes on by itself at a reduced pace.

## A tap on Telegram

![The same tap with one Mac, in a couple of seconds, and with the Director, within a minute](assets/diagrams/telegram-tap.svg)

This is the price of the security rule: the Director never opens a connection to a Mac, so an order waits for the next beat. In exchange one bot serves the projects of every Mac, and stays up while a Mac sleeps.

## A slot with the Director

![A slot asks the Director: it starts with a permit, or waits in the queue, or is dropped after 6 hours, or starts in local mode when the Director does not answer](assets/diagrams/slot-queue.svg)

Without the Director, a slot that finds its project busy stops and the run is lost. With it, the slot waits its turn. Slots always come before fill runs, and in local mode they stop only at the 5-hour cap and the reserve.

## Words used

- **heartbeat**: a scheduled run in a project, which picks one task and carries it through.
- **slot**: a fixed time of a project, with the work for that run if it has one.
- **fill run**: an extra run when the week's quota is behind the pace to 90%.
- **watchdog**: the launchd job that runs every minute on each Mac, at zero tokens.
- **beat**: the signed message a Mac sends the Director every minute.
- **permit**: the Director's go for a run: project, kind, model, longest duration, expiry.
- **order**: an answer, a note or a button from the dashboard or Telegram, which the Mac carries out.
- **local mode**: a Mac with no answer from the Director for 5 minutes: it goes on by itself, more slowly.
