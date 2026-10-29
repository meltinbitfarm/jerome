# Why Jérôme works this way

Claude Code is an excellent partner while you sit in front of it. Three things are missing once you get up:

- **It forgets.** Each session starts from nothing. Either you explain the project again, or you paste a long instructions file that costs tokens at every turn.
- **It works only while you are there.** The project stops when you close the laptop.
- **Unused quota is lost.** A subscription's weekly quota resets whether you used it or not. In a busy week you hit the limit, and in a quiet one you leave most of it on the table.

Jérôme fills those gaps for one person, or a small team, who runs several projects with a Claude subscription. Each choice below came from using it on real projects, and each says what was set aside and why.

## On the subscription, not an API key

Agents billed per token make every run a cost to weigh, and a busy night an unpleasant surprise. Jérôme runs Claude Code logged in with your subscription, so the cost is the one you already pay.

The subscription has its own limits instead: a 5-hour window and a 7-day window. Jérôme reads them from the same source as Claude Code's `/usage`, pauses its runs before they get in your way, and keeps a reserve of the week for you. With the [quota governor](quota-governor.md) on, it also starts extra runs while the week is behind its pace, so the quota goes to your backlog rather than being lost at the reset. The dollar figures Jérôme shows are API equivalents, a measure of how much of the subscription a project takes, not a bill.

## On your Mac

The work happens where the code, the tools, the test setup and the Claude Code login already are. Running agents in a hosted cloud would mean sending the code there, and giving the service a copy of your credentials and of every tool the project needs.

On your Mac, code, prompts, transcripts, paths and credentials never leave the machine. Nothing on it listens on the internet: the Telegram bridge and the link to the Director are calls the Mac makes, never calls it receives.

## Small context by design

Every token loaded at the start of a session is paid at every turn. Out of the box, a Claude Code session loads the descriptions of every plugin, skill and connector you have installed, about 29k tokens on the test machine. A Jérôme project turns those off for itself and starts at about 12k ([lean profile](lean-profile.md)). The lead agent's instructions are kept under 850 tokens, and the rest of the project's knowledge is in files read only when needed.

The same goes for runs on a schedule. Checks that cost nothing come first: is anyone working here, is the tree clean, is a limit reached. Then a triage on the smallest model, about 5,000 tokens, decides whether there is work and which. Only then does the main model start, with a cap on tokens and turns. Usage is recorded by Claude Code's hooks and status line, outside the model, so tracking costs nothing either.

## State in files, not in a service

A project's goal, decisions, open items, assumptions and digest are Markdown files in its repository, under `.jerome/`. You can read them, edit them, see their history in git, and take them elsewhere. A decision is one line with its reason, so it is not reopened every week.

Only usage figures, runs and requests live in a database, and it is kept outside the folder, one per clone, so no checkout or `git clean` reaches it ([database](database.md)).

## You decide, it does

An agent that asks about everything is a chore, and one that asks about nothing is a risk. The lead agent asks only about choices that cost money, cannot be undone, go outside the project, or change its goal or a recorded decision. Every other choice it makes itself and lists as an **assumption**, for you to confirm with one "OK" or correct. While a question waits, it goes on with whatever does not depend on the answer.

What it may not do is enforced, not requested. Pushing, deploying, publishing and sending email are denied by Claude Code's permission rules, for the lead agent and every subagent, so a confused model cannot do them anyway. It does those things as drafts for you. Each task is done on a branch and merged only when the tests pass.

## Nothing fails silently

A script that starts a model on a timer runs without a lock, a cap, a check of what it left behind, or anyone told when it fails. Jérôme's runs hold a lock per project and stop at their caps. Each run is checked when it ends: back on the main branch, a clean tree, a line written about what it did. Half-done work is resumed before anything new, and your own uncommitted work is never touched.

When something goes wrong, you get one sentence in plain words with the one thing to do, and on Telegram a button that does it: allow a tool, trust a folder, commit your changes, try again with a bigger budget, skip that work. A watchdog reports runs that should have started and did not, and closes those whose process died.

## Projects, not only code

A product needs more than code: a landing page, research, support. Jérôme organises a project in **areas**, each with its own goal, folder, agents, pace and priority, and a **milestone** with criteria you can check. When a milestone's criteria are met, the lead agent proposes the next one rather than inventing more work. Each agent runs on the model suited to its kind of work: the larger one for writing code and copy, smaller ones for reviews, research and documentation.

## Your phone, without a model

Most of what needs you is a choice between a few options, so it comes to Telegram as a question with buttons. The bridge has no model behind it. It costs no tokens, and nothing you write there can become an instruction for an agent: a message is an answer, a note for the project, or a button press, always data. A conversation with the lead agent needs a real session, which Claude Code's Remote Control already brings to the phone.

## Built on Claude Code, not beside it

Jérôme does not bring an agent runtime of its own. The lead agent is a Claude Code session, the team members are Claude Code subagents, the briefing is a skill, the guard rails are permission rules, and the tracking is hooks. When Claude Code improves, Jérôme improves with it. What Jérôme relies on that Claude Code could change is listed by `jerome deps`, so a tool watching Claude Code releases can tell when an update touches it.

## One Mac first, the Director after

One Mac is enough, and it is complete: the runs, the governor, Telegram, the viewer. A server was not made a requirement, because the work has to happen on the Mac anyway, where the code and the login are, and a coordinator in the middle would only be one more thing that can stop.

[Jérôme Director](director.md) is for those with several Macs on the same Claude account. They share one quota, so someone has to decide which Mac uses it and when, and you want one dashboard for all of them. The Director was designed so that it can never become a risk:

- It holds no secrets: the Macs send it percentages and short texts in plain words, never code, prompts, transcripts, paths or credentials.
- It never contacts a Mac. The Macs call it, and each request and answer is signed both ways.
- It listens only on your VPN address, and refuses a public one.
- If it stops, every Mac goes on working on its own.

## Not a good fit

- **A team working on the same project, or agents billed per token.** Jérôme is made for one subscription and the projects of the person who holds it.
- **Agents that act without you.** It is deliberately unable to publish, deploy or send on its own.
- **Linux servers with no desktop.** Sessions work, but scheduled runs use macOS's launchd for now.
