# LoomFlo Internals

Architecture documentation for non-standard features specific to LoomFlo. Each file follows the [template](TEMPLATE.md) and is capped at ~50 lines.

## Agents & Execution
- [Agent Hierarchy](agent-hierarchy.md) — 4-tier Loom/Loomi/Looma/Loomex with role-specific tools and models
- [DAG Execution](dag-execution.md) — Topological node activation, parallel branches, budget-aware scheduling
- [Review Cycle](review-cycle.md) — Loomex structured verdict (PASS/FAIL/BLOCKED) + adaptive retry
- [Escalation](escalation.md) — Loomi→Loom graph mutation mid-execution
- [Tool Matrix](tool-matrix.md) — 11 tools, write-scope enforcement, agent access control

## State & Communication
- [Shared Memory](shared-memory.md) — Append-only markdown files with per-file mutex
- [Message Bus](message-bus.md) — Intra-node agent messaging + file lock protocol
- [Persistence](persistence.md) — JSONL events + atomic JSON state, zero database

## Infrastructure
- [Spec Pipeline](spec-pipeline.md) — 6-phase generation from prompt to execution graph
- [File Ownership](file-ownership.md) — Two-tier access: permanent scopes + temporary locks
- [Cost Tracker](cost-tracker.md) — Per-agent/node tracking, pricing tables, budget enforcement
- [OAuth Credentials](oauth-credentials.md) — 3-source resolution chain with Claude Code integration
- [Daemon Lifecycle](daemon-lifecycle.md) — Singleton, graceful shutdown, interrupt recovery
- [Config System](config-system.md) — 3-level merge, level presets, hot-reload via FSWatcher
