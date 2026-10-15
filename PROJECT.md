# Jérôme

Source: brief.md (brief/v1, imported from MementoVault agent-orchestrator on 2026-10-14). From here on, the living source is PROJECT.md, scope.md, decisions.md and open.md (D36).

## Goal
A template repo to clone into a folder for each new project, built on Claude Code with a subscription: a lead agent runs the briefing, creates the subagents needed, coordinates them and reports back to Fabio. A lean, token-frugal alternative to the orchestration tools tried before.

## Constraints
- V1: Minimal token usage, including in the interaction between agents: top priority.
- V2: Lean and fast, little code, trouble-free setup.
- V3: Runs on Claude Code with a subscription login; setup checks installation and login.
- V4: Automatic pause above daily and weekly usage limits.

## Agent limits
- L1: No sending, publishing, deploying, merging to main, purchases or emails: drafts and proposals only (default).
