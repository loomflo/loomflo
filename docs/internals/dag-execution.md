# DAG Execution Engine

## What

Executes a directed acyclic graph of workflow nodes, activating nodes in topological order with parallel execution of independent branches.

## Why

Linear execution wastes time when nodes are independent. The DAG enables parallelism while respecting dependencies, with budget and delay awareness.

## How

The engine loops on a wake-up cycle:

1. Find all `pending` nodes whose predecessors are all `done`
2. Check budget before activating each node
3. Activate eligible nodes → state transitions to `running`
4. Run Loomi orchestration for each active node (parallel via `Promise.all`)
5. On node completion → trigger review (if enabled) → mark `done` or retry
6. Wake up and repeat until all nodes are `done` or workflow is stopped

Node states: `pending` → `waiting` → `running` → `review` → `done` | `failed` | `blocked`

The `waiting` state handles `defaultDelay` — a configurable pause between nodes (e.g., `"4h"`) managed by the scheduler with `resumeAt` timestamps.

Graph structure: `Map<string, Node>` for O(1) node lookup, `Array<{from, to}>` for edges.

## Files

- `packages/core/src/workflow/execution-engine.ts` — Main engine loop
- `packages/core/src/workflow/graph.ts` — Graph data structure + topological sort
- `packages/core/src/workflow/node.ts` — Node state wrapper
- `packages/core/src/workflow/scheduler.ts` — Delay scheduling with resumeAt
- `packages/core/src/workflow/workflow.ts` — Workflow state machine

## Gotchas

- Graph is mutable mid-execution — Loom escalations can add/remove/modify nodes while the engine runs.
- `resumeAt` timestamps survive daemon restarts (persisted in workflow.json).
- The engine is stoppable — `stop()` sets a flag that prevents new node activation.
- No deadlock detection on the graph itself (assumed acyclic from spec pipeline).
