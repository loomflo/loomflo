# Persistence Layer (Zero-Database)

## What

All state persisted to filesystem: workflow state as atomic JSON, events as append-only JSONL. No external database dependency.

## Why

LoomFlo runs on developer machines, not servers. A filesystem-only approach means zero setup, easy debugging (just read the files), and trivial backup (copy `.loomflo/`).

## How

### Workflow State (`state.ts`)

- **File**: `.loomflo/workflow.json`
- **Format**: JSON validated against `WorkflowSchema` (Zod)
- **Write strategy**: atomic — writes to `.workflow.json.tmp`, then `rename()` to avoid partial writes
- **Debounce**: 300ms — rapid state changes coalesce into a single write
- **Load**: `loadWorkflowState()` on daemon start, validates schema

Contains: graph (nodes + edges), node states, retry counters, resumeAt timestamps, config snapshot.

### Event Log (`events.ts`)

- **File**: `.loomflo/events.jsonl` (one JSON object per line)
- **Append-only**: never modified or truncated
- **19 event types**: `workflow_created`, `node_started`, `node_completed`, `node_failed`, `cost_tracked`, `escalation_received`, `graph_modified`, etc.

Each event:

```json
{"ts":"2026-04-02T20:20:10Z","type":"node_completed","workflowId":"wf-1","nodeId":"node-3","agentId":"loomi-node-3","details":{...}}
```

Query API at `/events` supports filtering by workflowId, nodeId, agentId, type.

## Files

- `packages/core/src/persistence/state.ts` — Workflow state read/write
- `packages/core/src/persistence/events.ts` — Event log append/query

## Gotchas

- JSONL file grows unbounded — no rotation or archival mechanism.
- The atomic rename trick requires source and target on the same filesystem.
- Schema validation on load means a hand-edited `workflow.json` with typos will fail to load.
