# Append-Only Shared Memory

## What
Markdown-based shared state between agents, using 7 append-only files with per-file mutex locking.

## Why
Agents run in parallel across nodes and need shared context without a database. Append-only markdown is human-readable, debuggable, and avoids write conflicts.

## How
The `SharedMemoryManager` manages 7 files in `.loomflo/shared-memory/`:

| File | Purpose |
|------|---------|
| `PROGRESS.md` | Execution milestones and step status |
| `DECISIONS.md` | Architecture and design choices |
| `ERRORS.md` | Critical failures and error context |
| `PREFERENCES.md` | User constraints and preferences |
| `ISSUES.md` | Known problems and workarounds |
| `INSIGHTS.md` | Technical discoveries during execution |
| `ARCHITECTURE_CHANGES.md` | Graph modifications made by Loom |

Every write appends a timestamped entry:
```
---
_[2026-04-02T20:20:10.632Z] written by loomi-node-3_

## Entry Title
Content here.
```

Reads are lock-free. Writes use `async-mutex` (one mutex per file) to serialize concurrent appenders.

The full content of these files is injected into every agent's system prompt as `sharedMemoryContent`.

## Files
- `packages/core/src/memory/shared-memory.ts` — Manager class
- `packages/core/src/tools/memory-read.ts` — Read tool (all agents)
- `packages/core/src/tools/memory-write.ts` — Write tool (all except Loomex)

## Gotchas
- **No size limit** — files grow unbounded. On long workflows, PROGRESS.md can reach hundreds of lines and inflate every agent's system prompt.
- Content is duplicated into every worker's prompt — 4 workers = 4× the token cost.
- No pruning or summarization mechanism exists yet.
