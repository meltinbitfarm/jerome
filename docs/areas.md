# Areas and milestones

A Jérôme project is a product or an initiative, not only a codebase. Its fronts of work are **areas**: development, marketing, research, support, or any other. Each area moves through **milestones** (an MVP, a beta, a launch), and each milestone has criteria that tell when it is reached. A project can start with one area and add others when they are needed.

## `.jerome/areas.md`

One section per area, with fixed lines that the CLI reads at zero tokens:

```markdown
# Areas

## development
- Goal: A web app to share shopping lists.
- Milestone: MVP
- Criteria: sign-up, one shared list, deployed by you
- Folder: .
- Agents: developer, analyst, documentarist
- Pace: daily
- Priority: 1

## marketing
- Goal: 200 people on the waiting list before launch.
- Milestone: pre-launch
- Criteria: landing page drafted in marketing/landing.md; three posts drafted
- Folder: marketing/
- Agents: writer, researcher
- Pace: weekly
- Priority: 2
```

| Line | Meaning |
|---|---|
| `## <name>` | the area's name: lowercase letters, digits and dashes |
| `Goal` | what the area must achieve, in one line |
| `Milestone` | the current milestone's name |
| `Criteria` | how to tell the milestone is reached, in one line, as things one can check |
| `Folder` | where its work goes: `.` for code where it already is, a folder such as `marketing/` otherwise |
| `Agents` | the agents of `.claude/agents/` that work on it; an agent may serve several areas |
| `Pace` | how often heartbeats may work on it: `hourly`, `daily`, `weekly`, or `paused` |
| `Priority` | 1 is the highest |

The file is versioned. The lead agent writes it with your confirmation, from the brief, the area briefing or the project-team skill. Each area's context and out of scope go in `scope.md`, under `## Area: <name>`. `jerome doctor` reports a malformed line, an agent without a file, a folder that does not exist yet, and a pace more frequent than the project's heartbeats.

**A project without `areas.md`** has one implicit area, `main`, whose goal and criteria are the project's goal and success criteria. Projects created before areas existed work as before, and `jerome state` and the viewer show no areas for them.

## Milestones

Only the current milestone is in `areas.md`. When its criteria look met, the lead agent checks them and opens a [decision request](heartbeat.md#decision-requests) that proposes the next milestone with its criteria, with three options: open it, continue the current one, or hold an area briefing. Until you answer, heartbeats give that area no work, rather than look for some in vain.

When you accept the proposed milestone, the lead agent updates `Milestone` and `Criteria`, in a heartbeat too, and records the closed one in `decisions.md`:

```
D12: development: MVP done → beta — sign-up and shared lists work, deployed on 2026-11-02
```

## The area briefing

The `project-brief` skill has a second mode, for an existing project: to add an area, or to open an area's next milestone with new criteria when they need a conversation. Ask the lead agent, for example "let's add a marketing area" or "let's plan the beta". It asks only what the project files do not say (goal, milestone, criteria, folder, pace, priority, any limit of the area's own), lists its proposals for you to confirm, then updates `areas.md` and `scope.md`, records the decisions, and proposes the agents the area needs with the `project-team` skill. Nothing is created before you confirm. The area briefing runs in Claude Code only, in a session: Claude Code protects the `.claude/` folder, so new agents and permission rules are written there with your approval, and a heartbeat cannot write them at all.

## Heartbeats

Before the [triage](heartbeat.md#what-a-heartbeat-does), the CLI leaves out, at zero tokens, the areas that are paused, those waiting for a decision request of their own, and those whose pace has not come round since their last heartbeat. The triage on Haiku gets the others, highest priority first, and picks one task in one of them. The run records its area, and the lead agent gets the area's folder, agents, milestone and criteria. A decision request opened in that heartbeat belongs to the area. When no area is due, the heartbeat ends with the reason, for example `no area due: development waiting for R4 · marketing weekly pace, last heartbeat 2026-10-15 09:00`.

## Usage per area

- A heartbeat that chose an area counts all of its usage there, the triage's included.
- In an interactive session, the usage of an agent listed in one area only counts for that area.
- The rest is `shared`: the lead agent's own turns in sessions, agents listed in several areas, and the triages of heartbeats that chose no area. Nothing is split by guesswork.
- With a single area, all of the project's usage is that area's.

`jerome state` shows one `areas` line, and the [viewer](commands/view.md) one section, with each area's milestone, pace, priority, last heartbeat, open request and usage over 7 days. Spending limits stay per project (see [limits.md](limits.md)).
