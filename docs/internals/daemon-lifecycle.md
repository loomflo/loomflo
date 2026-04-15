# Daemon Lifecycle & Persistence

## What

Background singleton process that hosts the workflow engine, API server, and WebSocket broadcaster, with graceful shutdown and interrupt recovery.

## Why

Workflows can run for hours. A persistent daemon decouples execution from the CLI session and survives terminal closures. The recovery mechanism handles crashes mid-node.

## How

### Startup

1. CLI `loomflo start` spawns a detached process via `daemon-entry.ts`
2. Daemon binds Fastify HTTP server on configured port (loopback only)
3. Generates 32-byte random auth token
4. Writes `daemon.json` to `.loomflo/`: `{port, host, token, pid}`
5. Loads workflow state from `.loomflo/workflow.json` if it exists

### Runtime

- All interaction through REST API (CLI, dashboard, external tools)
- WebSocket broadcasts real-time events (node status, costs, errors)
- Workflow state debounce-saved every 300ms to `workflow.json`

### Shutdown (SIGTERM)

1. `stopDispatching()` — prevents new LLM calls
2. `waitForActiveCalls(timeout)` — drains in-flight API calls
3. Marks running nodes as `interrupted` (persisted to workflow.json)
4. Closes HTTP server and WebSocket connections
5. Removes `daemon.json`

### Resume After Crash

On next `loomflo start` or `loomflo resume`:

- Loads persisted workflow state
- Resets `interrupted`/`running` nodes back to `pending`
- Respects `resumeAt` timestamps from the scheduler
- Re-activates the execution engine

## Files

- `packages/core/src/daemon.ts` — Daemon class
- `packages/core/src/daemon-entry.ts` — CLI entry point / process spawn

## Gotchas

- **Host whitelist**: Only `localhost`, `127.0.0.1`, `::1`, `0.0.0.0` allowed — no remote bind.
- `daemon.json` is the discovery mechanism — if deleted while running, CLI can't connect.
- In-memory state (MessageBus, pending messages) is lost on crash. Only workflow.json and shared memory survive.
