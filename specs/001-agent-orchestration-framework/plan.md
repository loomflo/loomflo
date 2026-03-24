# Implementation Plan: Loomflo — AI Agent Orchestration Framework

**Branch**: `001-agent-orchestration-framework` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-agent-orchestration-framework/spec.md`

## Summary

Build Loomflo, a persistent Node.js daemon that transforms natural language project descriptions into finished software through a directed graph of execution nodes, each powered by teams of AI agents. The system has two phases: (1) spec generation driven by an Architect agent (Loom), and (2) execution driven by Orchestrator agents (Loomi) supervising Worker agents (Loomas) with optional Reviewer agents (Loomex). The architecture uses a monorepo with 4 packages (core, cli, dashboard, sdk), Fastify for the REST/WebSocket API, React + React Flow for the dashboard, and an abstract LLMProvider interface with Anthropic Claude as the default provider.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js 20+ LTS
**Primary Dependencies**: Fastify 5.x, @fastify/websocket, commander, @anthropic-ai/sdk, React 19, @xyflow/react (React Flow v12), Vite 6.x, TailwindCSS 4.x, zod, tsup
**Storage**: JSON/JSONL files on disk (no external database)
**Testing**: Vitest, minimum 60% coverage
**Target Platform**: Linux, macOS, Windows (Node.js LTS)
**Project Type**: daemon + CLI + web dashboard + SDK (monorepo)
**Performance Goals**: Dashboard updates within 2 seconds of events, workflow resume within 30 seconds
**Constraints**: Single active workflow per daemon, localhost only, Anthropic-only provider for v1
**Scale/Scope**: ~14,500 lines across 7 build phases, ~80 source files, 4 packages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Type Safety & Code Quality | PASS | TypeScript strict mode, ESLint + Prettier enforced, Vitest with 60%+ coverage, zod for runtime validation, JSDoc on all public APIs |
| II. Async-First Architecture | PASS | async/await for all I/O, 4-package monorepo (core/cli/dashboard/sdk), no database, data-driven graph from workflow.json |
| III. Decoupled, Testable Components | PASS | TypeScript interfaces for all boundaries (LLMProvider, Tool, Agent), tool errors return strings not exceptions, MessageBus for agent communication, daemon-serialized shared memory |
| IV. Provider Abstraction | PASS | LLMProvider interface in `providers/base.ts`, @anthropic-ai/sdk imported only in `providers/anthropic.ts`, provider-normalized prompts, per-agent model config |
| V. Agent Isolation & Communication | PASS | MessageBus per node, shared memory via daemon, write scope enforcement via glob patterns, per-agent rate limiting, budget hard limit |
| VI. Security by Default | PASS | Workspace isolation per project, shell sandbox with path traversal detection, env-only API keys, localhost binding with auto-generated token, daemon-enforced write scopes |
| Delivery Standards | PASS | pnpm install && pnpm build from clean clone, GitHub Actions CI, README with diagram + quickstart, optional Docker, CLI via npm |

**Gate result: ALL PASS — proceed to Phase 0.**

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-orchestration-framework/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── rest-api.md
│   └── websocket.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
packages/
├── core/                                    → Orchestration engine
│   ├── src/
│   │   ├── index.ts                         → Public exports
│   │   ├── daemon.ts                        → Daemon lifecycle
│   │   ├── config.ts                        → 3-level config (zod schemas)
│   │   ├── workflow/
│   │   │   ├── workflow.ts                  → Workflow state machine
│   │   │   ├── graph.ts                     → Graph data structure + topology
│   │   │   ├── node.ts                      → Node lifecycle state machine
│   │   │   └── scheduler.ts                 → Delay management + persistence
│   │   ├── agents/
│   │   │   ├── base-agent.ts                → Agentic loop (LLM → tool_use → repeat)
│   │   │   ├── loom.ts                      → Architect agent
│   │   │   ├── loomi.ts                     → Orchestrator agent
│   │   │   ├── looma.ts                     → Worker agent
│   │   │   ├── loomex.ts                    → Reviewer agent
│   │   │   ├── message-bus.ts               → Per-agent async queues
│   │   │   └── prompts.ts                   → System prompt templates
│   │   ├── tools/
│   │   │   ├── base.ts                      → Tool interface (zod input schema)
│   │   │   ├── file-read.ts                 → read_file
│   │   │   ├── file-write.ts                → write_file (scope-enforced)
│   │   │   ├── file-edit.ts                 → edit_file (scope-enforced)
│   │   │   ├── file-search.ts               → search_files
│   │   │   ├── file-list.ts                 → list_files
│   │   │   ├── shell-exec.ts                → exec_command (sandboxed)
│   │   │   ├── memory-read.ts               → read_memory
│   │   │   ├── memory-write.ts              → write_memory (serialized)
│   │   │   ├── send-message.ts              → send_message (MessageBus)
│   │   │   ├── report-complete.ts           → report_complete
│   │   │   └── escalate.ts                  → escalate (Loomi → Loom)
│   │   ├── providers/
│   │   │   ├── base.ts                      → LLMProvider interface + LLMResponse
│   │   │   ├── anthropic.ts                 → AnthropicProvider (@anthropic-ai/sdk)
│   │   │   ├── openai.ts                    → Stub (throws "not yet supported")
│   │   │   └── ollama.ts                    → Stub (throws "not yet supported")
│   │   ├── memory/
│   │   │   └── shared-memory.ts             → Serialized .md read/write (async mutex)
│   │   ├── persistence/
│   │   │   ├── state.ts                     → workflow.json load/save
│   │   │   └── events.ts                    → events.jsonl append + schemas
│   │   ├── spec/
│   │   │   ├── spec-engine.ts               → Phase 1 flow (6-step pipeline)
│   │   │   └── prompts.ts                   → Spec generation prompts
│   │   ├── costs/
│   │   │   └── tracker.ts                   → Token tracking + budget enforcement
│   │   └── api/
│   │       ├── server.ts                    → Fastify factory (routes, WS, auth, CORS)
│   │       ├── auth.ts                      → Token-based auth middleware
│   │       ├── routes/
│   │       │   ├── chat.ts                  → POST /chat, GET /chat/history
│   │       │   ├── workflow.ts              → GET/POST /workflow/*
│   │       │   ├── nodes.ts                 → GET /nodes, GET /nodes/:id
│   │       │   ├── specs.ts                 → GET /specs, GET /specs/:name
│   │       │   ├── memory.ts                → GET /memory, GET /memory/:name
│   │       │   ├── config.ts                → GET/PUT /config
│   │       │   ├── costs.ts                 → GET /costs
│   │       │   ├── events.ts                → GET /events
│   │       │   └── health.ts                → GET /health
│   │       └── websocket.ts                 → WS /ws (real-time events)
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── package.json
│   └── tsconfig.json
│
├── cli/                                     → CLI thin client
│   ├── src/
│   │   ├── index.ts                         → Entry point (commander)
│   │   ├── client.ts                        → HTTP + WS client
│   │   └── commands/
│   │       ├── start.ts                     → loomflo start
│   │       ├── stop.ts                      → loomflo stop
│   │       ├── init.ts                      → loomflo init "prompt"
│   │       ├── chat.ts                      → loomflo chat "message"
│   │       ├── status.ts                    → loomflo status
│   │       ├── resume.ts                    → loomflo resume
│   │       ├── config.ts                    → loomflo config set/get
│   │       ├── dashboard.ts                 → loomflo dashboard
│   │       └── logs.ts                      → loomflo logs [node-id]
│   ├── package.json                         → bin: { "loomflo": "./dist/index.js" }
│   └── tsconfig.json
│
├── dashboard/                               → Web dashboard (Vite + React)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                          → Router
│   │   ├── pages/
│   │   │   ├── Home.tsx                     → Overview
│   │   │   ├── Graph.tsx                    → Interactive graph (React Flow)
│   │   │   ├── Node.tsx                     → Node detail
│   │   │   ├── Specs.tsx                    → Spec viewer
│   │   │   ├── Memory.tsx                   → Shared memory viewer
│   │   │   ├── Costs.tsx                    → Cost dashboard
│   │   │   ├── Config.tsx                   → Config editor
│   │   │   └── Chat.tsx                     → Chat with Loom
│   │   ├── components/
│   │   │   ├── GraphView.tsx                → React Flow wrapper
│   │   │   ├── NodeCard.tsx                 → Graph node component
│   │   │   ├── AgentStatus.tsx              → Agent indicator
│   │   │   ├── ReviewReport.tsx             → Review verdict display
│   │   │   ├── CostTracker.tsx              → Cost + budget gauge
│   │   │   ├── ChatInterface.tsx            → Chat UI
│   │   │   ├── MarkdownViewer.tsx           → Markdown renderer
│   │   │   └── LogStream.tsx                → Real-time log viewer
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts
│   │   │   ├── useWorkflow.ts
│   │   │   ├── useChat.ts
│   │   │   └── useCosts.ts
│   │   └── lib/
│   │       ├── api.ts                       → REST client
│   │       └── types.ts                     → Shared types
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
│
└── sdk/                                     → Public SDK
    ├── src/
    │   ├── index.ts                         → Public exports
    │   ├── client.ts                        → LoomfloClient class
    │   └── types.ts                         → Public types
    ├── package.json                         → name: "loomflo-sdk"
    └── tsconfig.json

Root files:
├── .github/workflows/ci.yml                → ESLint + tsc + vitest
├── turbo.json                               → Turborepo pipeline
├── pnpm-workspace.yaml                      → Workspace definition
├── package.json                             → Root scripts
├── tsconfig.base.json                       → Shared TS config
├── .env.example                             → ANTHROPIC_API_KEY=sk-ant-...
├── Dockerfile                               → Optional multi-stage
├── docker-compose.yml                       → Optional daemon + dashboard
├── LICENSE                                  → MIT
└── README.md
```

Per-project workspace (created by `loomflo init`):

```text
.loomflo/
├── config.json                              → Project config overrides
├── workflow.json                            → Graph: nodes, edges, states
├── events.jsonl                             → Append-only event log
├── daemon.json                              → Port + auth token (gitignored)
├── specs/
│   ├── constitution.md
│   ├── spec.md
│   ├── plan.md
│   ├── tasks.md
│   └── analysis-report.md
├── shared-memory/
│   ├── DECISIONS.md
│   ├── ERRORS.md
│   ├── PROGRESS.md
│   ├── PREFERENCES.md
│   ├── ISSUES.md
│   ├── INSIGHTS.md
│   └── ARCHITECTURE_CHANGES.md
└── nodes/
    └── node-{id}/
        ├── instructions.md
        ├── file-ownership.json
        ├── review.md
        └── logs/
            ├── orchestrator.log
            ├── agent-{id}.log
            └── reviewer.log
```

**Structure Decision**: Monorepo with 4 packages as mandated by the constitution (Principle II). The core package contains all orchestration logic. The CLI is a thin client that talks to the daemon's API. The dashboard is a standalone Vite/React app served by the daemon. The SDK wraps the API for programmatic use.

## Complexity Tracking

> No constitution violations. All complexity is justified by the spec requirements.

## Build Phases

### Phase 1 — Foundation (~2000 lines)

- Monorepo setup: pnpm-workspace.yaml, turbo.json, tsconfig.base.json, root package.json
- Core package skeleton: index.ts, config.ts (zod schemas + 3-level loading), daemon.ts (Fastify server start/stop)
- Persistence: state.ts (workflow.json read/write), events.ts (JSONL append + event type schemas)
- Core type definitions: Workflow, Node, Graph, Agent, Tool, LLMProvider, LLMResponse, Config
- CLI skeleton: commander setup, start/stop commands
- Fastify server with health endpoint + token auth
- CI: GitHub Actions workflow (ESLint + tsc --noEmit + vitest)
- ESLint + Prettier configuration
- Vitest configuration
- Dockerfile + docker-compose.yml (optional)

### Phase 2 — Agent Framework (~3000 lines)

- LLMProvider interface + AnthropicProvider implementation (full tool_use support)
- Base agent: agentic loop (LLM call → tool execution → repeat until end_turn)
- All 11 tools implemented: read_file, write_file, edit_file, search_files, list_files, exec_command, read_memory, write_memory, send_message, report_complete, escalate
- MessageBus: Map<agentId, AsyncQueue>, send/broadcast/collect
- Cost tracker: per-call tracking, model pricing table, budget enforcement
- Agent prompt templates (structured: role/task/context/reasoning/stop_conditions/output)
- Tests: agent loop with mock provider, each tool individually, message bus, cost tracker

### Phase 3 — Orchestration (~2500 lines)

- Graph data structure: nodes, edges, topologies (linear, divergent, convergent, tree, mixed)
- Node lifecycle state machine: pending → waiting → running → review → done/failed/blocked
- Workflow state machine: init → spec → building → running → paused → done
- Loomi: team planning, file scope assignment, Looma spawning, retry logic (adaptive + same), escalation
- Loomex: work inspection, structured report, verdict (PASS/FAIL/BLOCKED)
- Loom: graph management, escalation handling, graph modification (insert/remove/modify nodes)
- File Ownership System: scope assignment, write enforcement (picomatch), temporary lock protocol
- Scheduler: delay management (setTimeout + persistence for resume via resumeAt timestamps)
- Shared memory: serialized read/write (async mutex), .md file management, 7 standard files
- Tests: node lifecycle, retry cycle, escalation, file ownership, graph operations, scheduler

### Phase 4 — Spec Engine (~1500 lines)

- Phase 1 flow: constitution → specify → plan → tasks → analyze → build graph
- Spec generation prompts for each of the 6 phases
- Clarification handling: detect ambiguity, ask user via chat (max 3), resume with answers
- Graph building from tasks: automatic node grouping, dependency analysis, topology generation
- Cost estimation after graph build (estimate tokens per node based on instruction complexity)
- Tests: spec generation with mock LLM, graph building from tasks

### Phase 5 — API + CLI (~2000 lines)

- Full REST API: all routes (chat, workflow, nodes, specs, memory, config, costs, events, health)
- WebSocket: real-time event streaming (9 event types)
- Auth middleware: token-based, auto-generated at daemon start, stored in ~/.loomflo/daemon.json
- CLI commands: init, chat, status, resume, config set/get, dashboard (opens browser), logs
- SDK package: LoomfloClient class (connect, init, chat, status, onEvent), TypeScript types
- Tests: API routes, WebSocket events, CLI commands (integration)

### Phase 6 — Dashboard (~2500 lines)

- Vite + React 19 + TailwindCSS 4.x setup
- Graph page: React Flow integration, custom NodeCard components, live updates via WebSocket
- Node detail page: agent list, file scopes, log stream, review report, retry count
- Spec viewer: markdown rendering of all spec artifacts
- Memory viewer: shared memory files with timestamps
- Cost dashboard: per-node breakdown, budget gauge, total cost
- Config editor: form-based editing with zod validation
- Chat page: conversation UI with Loom (message list, input, streaming indicator)
- Home: overview (workflow status, active nodes, cost summary)

### Phase 7 — Polish (~1000 lines)

- Resume functionality: full test of daemon restart + state recovery from workflow.json + events.jsonl
- Graceful shutdown: let active agent calls finish, mark node as interrupted, save state
- End-to-end test: init → spec → execute → complete with a simple project
- README: architecture diagram (Mermaid), quick start (3 commands), real usage example
- .env.example, LICENSE (MIT)
- v0.1.0 tag

## Key Implementation Decisions

### Agent Loop

- Each agent is an async function (not a separate process) running inside the daemon's Node.js event loop
- Loop: collect context → call LLM via LLMProvider → if tool_use: execute tools, send results back → repeat → if end_turn: done
- Tool execution is synchronous from agent's perspective (await tool.execute())
- Tool errors are caught and returned as error strings — never thrown into the loop
- Each agent maintains its own message history (conversation with the LLM)
- Agents run concurrently within a node via Promise.all
- Stuck agent detection: wall-clock timeout AND per-call token cap (whichever hits first → failure → retry/escalation)

### MessageBus

- Map<agentId, AsyncQueue> — each agent has its own inbox
- send(from, to, content) pushes to target's queue
- At each loop iteration start, pending messages are collected and injected as context
- Messages logged to node's logs/ directory for audit

### File Ownership Enforcement

- write_file and edit_file tools receive the Looma's write scope (glob patterns)
- Before any write: check target path against scope patterns using picomatch
- Violation → return error string "Write denied: path outside your assigned scope"
- Loomi can grant temporary scope extensions via message protocol

### Persistence & Resume

- workflow.json: complete state snapshot, written after every state change
- events.jsonl: append-only, one JSON object per line (ts, type, nodeId, agentId, details)
- On restart: load workflow.json, verify against events.jsonl, resume from last completed node
- Active node at time of crash: restart from scratch (agent state is not persisted)
- Scheduler delays: store resumeAt timestamps; on restart, calculate remaining time

### Graceful Shutdown (loomflo stop)

- Stop dispatching new agent calls
- Let currently active LLM API calls finish
- Mark in-progress node as interrupted
- Save workflow.json and flush events.jsonl
- On resume: skip completed nodes, restart interrupted node from scratch

### Workflow Completion

- After last node completes: Loom sends completion message via chat, writes summary to shared memory (PROGRESS.md)
- Daemon stays running, Loom remains available for further instructions (rerun nodes, add nodes, start new project)
- Developer must explicitly run `loomflo stop` to shut down

### Node Status State Machine

```text
pending ──(predecessors complete)──→ waiting ──(delay expires)──→ running
                                                                    │
                                              ┌─────────────────────┤
                                              ▼                     ▼
                                           review              failed/blocked
                                              │                 (retry/escalate)
                                              ▼
                                        done (PASS)
```

- **pending**: predecessors not yet complete (dependency-blocked)
- **waiting**: predecessors done, delay timer counting down
- **running**: agents actively working
- **review**: Loomex inspecting (if enabled)
- **done**: completed successfully
- **failed**: exhausted all retries
- **blocked**: deemed impossible, escalated to Architect

### Event Log vs Shared Memory

- **Event log** (events.jsonl): structured, append-only, machine-readable. Powers dashboard activity feed, `loomflo logs`, `loomflo status`, and resume logic.
- **Shared memory** (.md files): agent-facing semantic context in natural language. Agents read DECISIONS.md for past choices, ERRORS.md for past failures, etc.
- Two distinct systems with distinct consumers. Event log is never parsed by agents; shared memory is never queried for timeline reconstruction.

### LLM Provider Interface

```typescript
interface LLMProvider {
  complete(params: {
    messages: Message[];
    system: string;
    tools?: ToolDefinition[];
    model: string;
    maxTokens?: number;
  }): Promise<LLMResponse>;
}

interface LLMResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use";
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}
```

AnthropicProvider translates to/from the Anthropic Messages API format. Future providers translate to/from their respective formats. All provider-specific logic is contained within the provider file.

### Cost Tracking

- Every LLM API call is wrapped by the cost tracker
- Input/output tokens recorded per call (from API response metadata)
- Cost calculated from configurable per-model pricing table
- Per-node cost = sum of all agent calls in that node (including retries)
- Total cost = sum of all nodes + Loom's own calls
- Budget enforcement: if budgetLimit set and total >= limit → pause workflow, notify developer

### WebSocket Events

```text
node_status      — nodeId, status, timestamp
agent_status     — nodeId, agentId, status, task
agent_message    — nodeId, from, to, summary
review_verdict   — nodeId, verdict, summary
graph_modified   — action, details
cost_update      — nodeId, totalCost, budgetRemaining
memory_updated   — file, summary
spec_artifact_ready — name, path
chat_response    — message
```

### Event Types (events.jsonl)

```text
workflow_created, workflow_started, workflow_paused, workflow_resumed, workflow_completed
spec_phase_started, spec_phase_completed
graph_built, graph_modified
node_started, node_completed, node_failed, node_blocked
agent_created, agent_completed, agent_failed
reviewer_started, reviewer_verdict
retry_triggered, escalation_triggered
message_sent, cost_tracked, memory_updated
```
