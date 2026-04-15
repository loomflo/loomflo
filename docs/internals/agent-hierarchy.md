# Agent Hierarchy (Loom / Loomi / Looma / Loomex)

## What

Four-tier agent architecture where each role has distinct capabilities, tools, and model assignments.

## Why

A monolithic agent can't scale to complex projects — it loses focus, blows context, and can't parallelize. Splitting into specialized roles lets each agent operate within a narrow scope with only the tools it needs.

## How

Each tier maps to a specific responsibility:

- **Loom** (Architect) — runs the spec pipeline, handles escalations, chats with the user. Model: `opus` by default. Has read + memory + message tools, no write.
- **Loomi** (Orchestrator) — one per node. Plans a team of Loomas, assigns file scopes, coordinates retries, runs Loomex review. Model: `sonnet`. Has read + memory + escalate tools.
- **Looma** (Worker) — multiple per node, spawned by Loomi. Writes code, runs commands. Model: `sonnet`. Only agent with write + exec tools.
- **Loomex** (Reviewer) — optional per node. Read-only verification, returns structured verdict. Model: `sonnet`. Has read + search tools only, zero write access.

Workers run in parallel within a node. Loomi serializes between planning → execution → review → retry.

## Files

- `packages/core/src/agents/loom.ts` — Architect agent
- `packages/core/src/agents/loomi.ts` — Orchestrator (team planning, retry, review dispatch)
- `packages/core/src/agents/looma.ts` — Worker agent factory
- `packages/core/src/agents/loomex.ts` — Reviewer agent
- `packages/core/src/agents/base-agent.ts` — Shared agent loop (`runAgentLoop`)

## Gotchas

- Loomas are stateless — spawned fresh each time, context passed via system prompt.
- Model assignments are overridable per-role via config `level` presets (1/2/3).
- `maxLoomasPerLoomi` caps parallelism; defaults vary by level.
