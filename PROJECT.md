# Jérôme

Source: brief.md (brief/v1, imported from MementoVault agent-orchestrator on 2026-10-14). From here on, the living source is PROJECT.md, decisions.md and open.md.

## Goal
A template repo to clone into a folder for each new project, built on Claude Code with a subscription: a lead agent runs the briefing, creates the subagents needed, coordinates them and reports back to Fabio. A lean, token-frugal alternative to the orchestration tools tried before.

## Context
- Other orchestration tools tried so far were too heavy for Fabio's workflow: the goal is something leaner.
- Fabio usually starts with a briefing in chat, often dictated from the phone, then moves to the PC: the tool must make exactly this start easy.
- There is an earlier design (drag-and-drop graph, Company → project → agents hierarchy), see Q4.

## Constraints
- V1: Minimal token usage, including in the interaction between agents: top priority.
- V2: Lean and fast, little code, trouble-free setup.
- V3: Runs on Claude Code with a subscription login; setup checks installation and login.
- V4: Automatic pause above daily and weekly usage limits.

## Agent limits
- L1: No sending, publishing, deploying, merging to main, purchases or emails: drafts and proposals only (default).

## Tools
- Claude Code (subscription), SQLite. MementoVault is no longer used (D33).

## Out of scope
- A dedicated interface for talking to the agents.
- Agent Teams.

## Success
- From a brief saved on the phone, a single command on the PC leads to a project with the lead agent ready.
- Redoing the briefing on the original idea of this chat leads to the same decisions.
- Per-project usage visible and kept under control thanks to the limits.
