# Tasks: Loomflo — AI Agent Orchestration Framework

**Input**: Design documents from `/specs/001-agent-orchestration-framework/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/, research.md, quickstart.md

**Tests**: Included — the constitution mandates Vitest with 60%+ coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. The foundational phase contains shared infrastructure that all stories depend on.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Monorepo initialization and toolchain configuration

- [x] T001 Create root package.json with workspace scripts (build, test, lint, dev, clean) in package.json
- [x] T002 Create pnpm-workspace.yaml defining packages/core, packages/cli, packages/dashboard, packages/sdk in pnpm-workspace.yaml
- [x] T003 Create turbo.json with build/test/lint pipeline configuration in turbo.json
- [x] T004 Create shared TypeScript base config with strict mode in tsconfig.base.json
- [x] T005 [P] Create packages/core/package.json with dependencies (fastify, @fastify/websocket, zod, picomatch, async-mutex) and packages/core/tsconfig.json
- [x] T006 [P] Create packages/cli/package.json with dependencies (commander) and bin entry, packages/cli/tsconfig.json
- [x] T007 [P] Create packages/dashboard/package.json with dependencies (react, @xyflow/react, react-markdown, react-router-dom) and packages/dashboard/tsconfig.json
- [x] T008 [P] Create packages/sdk/package.json (name: loomflo-sdk) and packages/sdk/tsconfig.json
- [x] T009 [P] Configure ESLint (strict TypeScript rules) and Prettier in root .eslintrc.cjs and .prettierrc
- [x] T010 [P] Configure Vitest in root vitest.config.ts and packages/core/vitest.config.ts
- [x] T011 [P] Create GitHub Actions CI workflow in .github/workflows/ci.yml (ESLint + tsc --noEmit + vitest)
- [x] T012 [P] Create .env.example with ANTHROPIC_API_KEY placeholder

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, interfaces, persistence, config, daemon, LLM provider, tools, agent loop, and supporting infrastructure. ALL user stories depend on this phase.

**WARNING**: No user story work can begin until this phase is complete.

### Core Types & Schemas

- [x] T013 Define all core TypeScript types and zod schemas (Workflow, WorkflowStatus, Node, NodeStatus, Graph, Edge, TopologyType, AgentInfo, AgentRole, AgentStatus, ReviewReport, TaskVerification, Event, EventType, Message, Config, Tool, ToolDefinition, LLMProvider, LLMResponse, ContentBlock, SharedMemoryFile) in packages/core/src/types.ts
- [x] T014 Define config zod schema with all configurable parameters and defaults in packages/core/src/config.ts
- [x] T015 Implement 3-level config loading (global ~/.loomflo/config.json → project .loomflo/config.json → CLI overrides) with deep merge in packages/core/src/config.ts

### Persistence

- [x] T016 [P] Implement workflow state persistence (load/save workflow.json, debounced writes) in packages/core/src/persistence/state.ts
- [x] T017 [P] Implement event log (append to events.jsonl, event type schemas, query by type/nodeId with filtering) in packages/core/src/persistence/events.ts

### Daemon & API Server

- [x] T018 Implement daemon lifecycle (Fastify server start on 127.0.0.1, stop, graceful shutdown, auto-generate auth token to ~/.loomflo/daemon.json) in packages/core/src/daemon.ts
- [x] T019 Implement token-based auth middleware (read token from ~/.loomflo/daemon.json, validate Authorization header) in packages/core/src/api/auth.ts
- [x] T020 Create Fastify server factory (register routes, WebSocket, auth middleware, CORS, static file serving for dashboard) in packages/core/src/api/server.ts
- [x] T021 Implement GET /health route (no auth, daemon status + uptime + workflow summary) in packages/core/src/api/routes/health.ts

### LLM Provider

- [x] T022 Define LLMProvider interface and LLMResponse type (complete method with messages, system, tools, model, maxTokens) in packages/core/src/providers/base.ts
- [x] T023 Implement AnthropicProvider (wrap @anthropic-ai/sdk, translate tool_use format, handle streaming, extract token usage) in packages/core/src/providers/anthropic.ts
- [x] T024 [P] Create OpenAI provider stub (implements interface, throws "not yet supported") in packages/core/src/providers/openai.ts
- [x] T025 [P] Create Ollama provider stub (implements interface, throws "not yet supported") in packages/core/src/providers/ollama.ts

### Tools

- [x] T026 Define Tool interface (name, description, inputSchema as zod, execute returning Promise<string>) in packages/core/src/tools/base.ts
- [x] T027 [P] Implement read_file tool (read file content from workspace, path validation) in packages/core/src/tools/file-read.ts
- [x] T028 [P] Implement write_file tool (create/overwrite file, scope enforcement via picomatch, workspace path validation) in packages/core/src/tools/file-write.ts
- [x] T029 [P] Implement edit_file tool (string replacement in file, scope enforcement, workspace path validation) in packages/core/src/tools/file-edit.ts
- [x] T030 [P] Implement search_files tool (regex/glob content search within workspace) in packages/core/src/tools/file-search.ts
- [x] T031 [P] Implement list_files tool (glob pattern file listing within workspace) in packages/core/src/tools/file-list.ts
- [x] T032 [P] Implement exec_command tool (sandboxed shell exec, path traversal detection, symlink check, workspace restriction) in packages/core/src/tools/shell-exec.ts
- [x] T033 [P] Implement read_memory tool (read shared memory .md file) in packages/core/src/tools/memory-read.ts
- [x] T034 [P] Implement write_memory tool (append to shared memory .md file, daemon-serialized) in packages/core/src/tools/memory-write.ts
- [x] T035 [P] Implement send_message tool (send message via MessageBus to agent in same node) in packages/core/src/tools/send-message.ts
- [x] T036 [P] Implement report_complete tool (Looma signals task completion) in packages/core/src/tools/report-complete.ts
- [x] T037 [P] Implement escalate tool (Loomi requests graph modification from Loom) in packages/core/src/tools/escalate.ts

### Agent Framework

- [x] T038 Implement base agent loop (collect context → call LLM → process tool_use → repeat → end_turn, with timeout and token cap enforcement) in packages/core/src/agents/base-agent.ts
- [x] T039 Implement MessageBus (Map<agentId, AsyncQueue>, send/broadcast/collect, message logging) in packages/core/src/agents/message-bus.ts
- [x] T040 Define structured prompt templates for each agent role (role/task/context/reasoning/stop_conditions/output sections) in packages/core/src/agents/prompts.ts

### Cost Tracking

- [x] T041 Implement cost tracker (per-call token tracking, configurable model pricing table, per-node aggregation, total cost, budget enforcement with pause) in packages/core/src/costs/tracker.ts
- [x] T041a Implement per-agent LLM API rate limiter (configurable max calls per minute per agent, token-bucket algorithm, reject with structured error when exceeded) in packages/core/src/costs/rate-limiter.ts

### Shared Memory

- [x] T042 Implement shared memory manager (read/write .md files with async mutex serialization, initialize 7 standard files, format enforcement) in packages/core/src/memory/shared-memory.ts

### Foundational Tests

- [x] T043 [P] Write unit tests for config loading (3-level merge, zod validation, defaults) in packages/core/tests/unit/config.test.ts
- [x] T044 [P] Write unit tests for persistence (state save/load, event append/query) in packages/core/tests/unit/persistence.test.ts
- [x] T045 [P] Write unit tests for all 11 tools (scope enforcement, sandbox, error strings) in packages/core/tests/unit/tools.test.ts
- [x] T046 [P] Write unit tests for base agent loop with mock LLMProvider (tool_use cycle, end_turn, timeout, token cap) in packages/core/tests/unit/agent.test.ts
- [x] T047 [P] Write unit tests for MessageBus (send, collect, broadcast, cross-node rejection) in packages/core/tests/unit/message-bus.test.ts
- [x] T048 [P] Write unit tests for cost tracker (per-call tracking, budget enforcement, pause trigger) in packages/core/tests/unit/costs.test.ts
- [x] T049 [P] Write unit tests for shared memory (serialized writes, concurrent access, format) in packages/core/tests/unit/shared-memory.test.ts

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — Spec Generation & Graph Planning (Priority: P1) MVP

**Goal**: Developer runs `loomflo init "..."` and gets a complete spec suite + execution graph for review.

**Independent Test**: Run `loomflo start` + `loomflo init "Build a todo app"`, verify 6 spec artifacts produced and graph is valid.

### Implementation for User Story 1

- [x] T050 [US1] Implement spec engine 6-step pipeline (constitution → specify → plan → tasks → analyze → build graph) in packages/core/src/spec/spec-engine.ts
- [x] T051 [US1] Write system prompts for each spec generation phase (constitution prompt, spec prompt, plan prompt, tasks prompt, analysis prompt, graph builder prompt) in packages/core/src/spec/prompts.ts
- [x] T052 [US1] Implement clarification handling (detect ambiguity markers, ask user via chat API max 3 questions, resume with answers) in packages/core/src/spec/spec-engine.ts
- [x] T053 [US1] Implement graph builder from tasks (automatic node grouping, dependency analysis, topology detection, cost estimation) in packages/core/src/spec/spec-engine.ts
- [x] T054 [US1] Implement Loom agent spec-generation mode (drives spec engine, manages Phase 1 flow, writes artifacts to .loomflo/specs/) in packages/core/src/agents/loom.ts
- [x] T055 [US1] Implement POST /workflow/init route (accept description + projectPath + config, launch Loom spec generation, return workflow ID) in packages/core/src/api/routes/workflow.ts
- [x] T056 [US1] Implement GET /workflow route (return current workflow state including graph) in packages/core/src/api/routes/workflow.ts
- [x] T057 [US1] Implement POST /workflow/start route (confirm spec, transition to execution phase) in packages/core/src/api/routes/workflow.ts
- [x] T058 [US1] Implement GET /specs and GET /specs/:name routes (list and read spec artifacts) in packages/core/src/api/routes/specs.ts
- [x] T059 [US1] Implement CLI `loomflo init "prompt"` command (call POST /workflow/init, show progress, report completion) in packages/cli/src/commands/init.ts
- [x] T060 [US1] Implement CLI entry point with commander setup and command registration in packages/cli/src/index.ts
- [x] T061 [US1] Implement CLI HTTP + WebSocket client (connect to daemon, auth token, request/response) in packages/cli/src/client.ts
- [x] T062 [US1] Implement CLI `loomflo start` command (spawn daemon as detached child process, write daemon.json) in packages/cli/src/commands/start.ts
- [x] T063 [US1] Implement CLI `loomflo stop` command (call daemon shutdown, wait for active calls to finish) in packages/cli/src/commands/stop.ts

### Tests for User Story 1

- [x] T064 [P] [US1] Write unit tests for spec engine (mock LLM, verify 6 artifacts produced, graph validity) in packages/core/tests/unit/spec-engine.test.ts
- [x] T065 [P] [US1] Write integration test for workflow init API route in packages/core/tests/integration/workflow-init.test.ts

**Checkpoint**: Developer can init a project, generate specs, and review them. MVP complete.

---

## Phase 4: User Story 2 — Workflow Execution (Priority: P2)

**Goal**: After confirming spec, the system executes the workflow node by node with agent teams, review, retry, and escalation.

**Independent Test**: Provide a pre-built workflow.json with a 3-node linear graph. Verify nodes execute in order, workers produce files, reviewer validates, and workflow completes.

### Implementation for User Story 2

- [x] T066 [US2] Implement Graph data structure (nodes Map, edges array, add/remove/modify nodes and edges, topology detection, DAG validation, cycle detection) in packages/core/src/workflow/graph.ts
- [x] T067 [US2] Implement Node lifecycle state machine (pending → waiting → running → review → done/failed/blocked, with transition validation) in packages/core/src/workflow/node.ts
- [x] T068 [US2] Implement Workflow state machine (init → spec → building → running → paused → done, state transitions, persistence after each change) in packages/core/src/workflow/workflow.ts
- [x] T069 [US2] Implement Scheduler (delay management with setTimeout, resumeAt timestamp persistence, remaining time on restart, immediate execute if past) in packages/core/src/workflow/scheduler.ts
- [x] T070 [US2] Implement Loomi agent (read node instructions, plan team size/roles, assign file scopes via picomatch non-overlapping validation, spawn Loomas via Promise.all, handle report_complete signals) in packages/core/src/agents/loomi.ts
- [x] T071 [US2] Implement Looma agent (receive structured prompt + write scope + tools, execute task within scope, communicate via MessageBus, report completion) in packages/core/src/agents/looma.ts
- [x] T072 [US2] Implement Loomex agent (receive node instructions + spec + files produced, inspect work quality, generate structured verdict PASS/FAIL/BLOCKED with task-level details) in packages/core/src/agents/loomex.ts
- [x] T073 [US2] Implement retry logic in Loomi (on FAIL: generate adapted prompt from Loomex feedback, relaunch only failed Loomas, track retry count, enforce maxRetriesPerNode/maxRetriesPerTask) in packages/core/src/agents/loomi.ts
- [x] T074 [US2] Implement escalation logic (on BLOCKED or max retries: Loomi escalates to Loom, Loom modifies graph to work around issue) in packages/core/src/agents/loomi.ts
- [x] T075 [US2] Implement Loom agent execution mode (monitor shared memory asynchronously, handle escalations, insert/remove/modify graph nodes, log changes to ARCHITECTURE_CHANGES.md) in packages/core/src/agents/loom.ts
- [x] T076 [US2] Implement File Ownership System (scope assignment validation for non-overlap, write enforcement in tools, temporary lock protocol via MessageBus) in packages/core/src/workflow/node.ts
- [x] T077 [US2] Implement workflow execution engine (iterate graph by topology, activate nodes when predecessors done, handle parallel/convergent/divergent paths, never deadlock) in packages/core/src/workflow/workflow.ts
- [x] T078 [US2] Implement GET /nodes and GET /nodes/:id routes (list nodes with status/cost, node detail with agents/scopes/logs) in packages/core/src/api/routes/nodes.ts
- [x] T079 [US2] Implement GET /nodes/:id/review route (Loomex review report) in packages/core/src/api/routes/nodes.ts
- [x] T080 [US2] Implement WebSocket event broadcasting (emit node_status, agent_status, agent_message, review_verdict, graph_modified events to connected clients) in packages/core/src/api/websocket.ts

### Tests for User Story 2

- [x] T081 [P] [US2] Write unit tests for Graph (add/remove nodes, DAG validation, cycle rejection, topology detection) in packages/core/tests/unit/graph.test.ts
- [x] T082 [P] [US2] Write unit tests for Node lifecycle (state transitions, invalid transition rejection) in packages/core/tests/unit/node.test.ts
- [x] T083 [P] [US2] Write unit tests for Scheduler (delay timing, resumeAt persistence, past-due immediate execute) in packages/core/tests/unit/scheduler.test.ts
- [x] T084 [P] [US2] Write unit tests for retry cycle (FAIL → adapted prompt → relaunch, max retries → escalation) in packages/core/tests/unit/retry.test.ts
- [x] T085 [P] [US2] Write unit tests for File Ownership (scope validation, overlap rejection, write enforcement) in packages/core/tests/unit/file-ownership.test.ts

**Checkpoint**: Full workflow execution works. Nodes run in order, agents produce files, review/retry/escalation cycle functions.

---

## Phase 5: User Story 3 — Real-Time Dashboard Monitoring (Priority: P3)

**Goal**: Developer opens web dashboard and sees workflow in real time — graph, agents, messages, costs.

**Independent Test**: Start daemon, initiate workflow, open dashboard. Verify node statuses update in real time, agent activity visible, costs increment.

### Implementation for User Story 3

- [x] T086 [US3] Initialize Vite + React 19 + TailwindCSS 4.x project with React Router in packages/dashboard/ (main.tsx, App.tsx with routes, index.html, vite.config.ts, tailwind.config.ts)
- [x] T087 [US3] Implement shared types in packages/dashboard/src/lib/types.ts (mirror core types for Workflow, Node, Agent, ReviewReport, Event, Config, Cost)
- [x] T088 [US3] Implement REST API client (fetch wrapper with auth token, typed responses) in packages/dashboard/src/lib/api.ts
- [x] T089 [US3] Implement useWebSocket hook (connect to WS /ws with auth, dispatch events to subscribers, reconnect with backoff) in packages/dashboard/src/hooks/useWebSocket.ts
- [x] T090 [US3] Implement useWorkflow hook (fetch workflow state via REST, update on WS events) in packages/dashboard/src/hooks/useWorkflow.ts
- [x] T091 [US3] Implement GraphView component (React Flow wrapper: custom node layout, edge styling, auto-layout, programmatic updates) in packages/dashboard/src/components/GraphView.tsx
- [x] T092 [US3] Implement NodeCard component (title, status badge with colors per status, agent count, cost, click to navigate) in packages/dashboard/src/components/NodeCard.tsx
- [x] T093 [US3] Implement AgentStatus component (role icon, state indicator, current task description) in packages/dashboard/src/components/AgentStatus.tsx
- [x] T094 [US3] Implement LogStream component (real-time log viewer with agent filtering, auto-scroll) in packages/dashboard/src/components/LogStream.tsx
- [x] T095 [US3] Implement ReviewReport component (verdict badge PASS/FAIL/BLOCKED, task checklist, details, recommendation) in packages/dashboard/src/components/ReviewReport.tsx
- [x] T096 [US3] Implement MarkdownViewer component (react-markdown with syntax highlighting via rehype-highlight) in packages/dashboard/src/components/MarkdownViewer.tsx
- [x] T097 [US3] Implement Graph page (full-screen graph view with live status updates, click node for detail) in packages/dashboard/src/pages/Graph.tsx
- [x] T098 [US3] Implement Node detail page (agent list, file scopes, log stream, review report, retry count, cost) in packages/dashboard/src/pages/Node.tsx
- [x] T099 [US3] Implement Home page (overview: workflow status, active nodes summary, cost summary, recent events) in packages/dashboard/src/pages/Home.tsx
- [x] T100 [US3] Implement Specs page (list spec artifacts, render selected artifact as markdown) in packages/dashboard/src/pages/Specs.tsx
- [x] T101 [US3] Implement Memory page (list shared memory files, render selected file as markdown, show last modified timestamp) in packages/dashboard/src/pages/Memory.tsx
- [x] T102 [US3] Implement GET /memory and GET /memory/:name routes in packages/core/src/api/routes/memory.ts
- [x] T103 [US3] Implement GET /events route (query event log with type/nodeId filtering, pagination) in packages/core/src/api/routes/events.ts
- [x] T104 [US3] Configure Fastify to serve built dashboard as static files at root path in packages/core/src/api/server.ts

**Checkpoint**: Dashboard shows live workflow with graph, agents, messages, specs, memory, costs.

---

## Phase 6: User Story 4 — Conversational Interface (Priority: P4)

**Goal**: Developer chats with Loom via CLI or dashboard during both phases.

**Independent Test**: Start workflow, send `loomflo chat "how is auth implemented?"`, verify Loom responds appropriately.

### Implementation for User Story 4

- [x] T105 [US4] Implement Loom routing logic (classify user message as question/instruction/graph-change, route to appropriate handler) in packages/core/src/agents/loom.ts
- [x] T106 [US4] Implement POST /chat route (send message to Loom, return response + optional action taken) in packages/core/src/api/routes/chat.ts
- [x] T107 [US4] Implement GET /chat/history route (return persisted conversation history) in packages/core/src/api/routes/chat.ts
- [x] T108 [US4] Implement chat_response WebSocket event (broadcast Loom responses to dashboard) in packages/core/src/api/websocket.ts
- [x] T109 [US4] Implement CLI `loomflo chat "message"` command (call POST /chat, display response, show action if taken) in packages/cli/src/commands/chat.ts
- [x] T110 [US4] Implement ChatInterface component (message list, text input, typing/streaming indicator) in packages/dashboard/src/components/ChatInterface.tsx
- [x] T111 [US4] Implement useChat hook (send messages via REST, receive responses via WS, manage conversation state) in packages/dashboard/src/hooks/useChat.ts
- [x] T112 [US4] Implement Chat page (full chat UI with Loom, display action confirmations) in packages/dashboard/src/pages/Chat.tsx

**Checkpoint**: Developer can chat with Loom via CLI and dashboard during both phases.

---

## Phase 7: User Story 5 + 9 — Configuration (Priority: P5/P9)

**Goal**: Developer configures the framework before and during execution. Mid-execution changes take effect at next node activation.

**Independent Test**: Set `reviewerEnabled: false`, verify next node skips review. Set delay, verify delay observed.

### Implementation for User Story 5 + 9

- [x] T113 [US5] Implement GET /config and PUT /config routes (return merged config, validate updates with zod, persist to project config) in packages/core/src/api/routes/config.ts
- [x] T114 [US5] Implement runtime config reload (on PUT /config or file change, re-merge config, apply to next node activation only) in packages/core/src/config.ts
- [x] T115 [US5] Implement CLI `loomflo config set <key> <value>` and `loomflo config get <key>` commands in packages/cli/src/commands/config.ts
- [x] T116 [US5] Implement Config page (form-based config editing with zod validation, show current merged config with source indicators) in packages/dashboard/src/pages/Config.tsx
- [x] T117 [P] [US5] Write unit tests for config merge (3-level override, per-node override, mid-execution change semantics) in packages/core/tests/unit/config-merge.test.ts

**Checkpoint**: Configuration works at all levels. Mid-execution changes apply to next node.

---

## Phase 8: User Story 6 — Workflow Resume (Priority: P6)

**Goal**: Interrupted workflow resumes from last completed node.

**Independent Test**: Start multi-node workflow, kill daemon mid-execution, run `loomflo resume`, verify completed nodes skipped and execution continues.

### Implementation for User Story 6

- [x] T118 [US6] Implement resume logic (load workflow.json, identify completed/interrupted nodes, restart interrupted node from scratch, recalculate scheduler delays) in packages/core/src/workflow/workflow.ts
- [x] T119 [US6] Implement state recovery verification (cross-check workflow.json against events.jsonl for consistency, detect corruption) in packages/core/src/persistence/state.ts
- [x] T120 [US6] Implement graceful shutdown (stop dispatching new agent calls, wait for active calls, mark node interrupted, flush events.jsonl, save workflow.json) in packages/core/src/daemon.ts
- [x] T121 [US6] Implement POST /workflow/pause and POST /workflow/resume routes in packages/core/src/api/routes/workflow.ts
- [x] T122 [US6] Implement CLI `loomflo resume` command (call POST /workflow/resume, show resume status) in packages/cli/src/commands/resume.ts
- [x] T123 [P] [US6] Write integration test for resume (simulate crash, verify state recovery, verify completed nodes skipped) in packages/core/tests/integration/resume.test.ts

**Checkpoint**: Workflows survive interruptions and resume correctly.

---

## Phase 9: User Story 7 — Cost Monitoring (Priority: P7)

**Goal**: Developer monitors costs in real time via dashboard and CLI.

**Independent Test**: Run workflow, check `loomflo status` shows per-node costs. Set budget limit, verify workflow pauses when reached.

### Implementation for User Story 7

- [x] T124 [US7] Implement GET /costs route (per-node costs, total, budget remaining, Loom overhead cost) in packages/core/src/api/routes/costs.ts
- [x] T125 [US7] Implement cost_update WebSocket event (broadcast after every LLM call with call cost, node cost, total, budget remaining) in packages/core/src/api/websocket.ts
- [x] T126 [US7] Implement CostTracker component (progress bar toward budget, per-node cost breakdown table) in packages/dashboard/src/components/CostTracker.tsx
- [x] T127 [US7] Implement useCosts hook (fetch costs via REST, update on WS cost_update events) in packages/dashboard/src/hooks/useCosts.ts
- [x] T128 [US7] Implement Costs page (tokens per agent, cost per node including retries, total, budget gauge) in packages/dashboard/src/pages/Costs.tsx
- [x] T129 [US7] Implement CLI `loomflo status` command (workflow state, active node, per-node costs, total cost, budget remaining) in packages/cli/src/commands/status.ts

**Checkpoint**: Costs visible in real time. Budget enforcement pauses workflow.

---

## Phase 10: User Story 8 — Real-Time Graph Building (Priority: P8)

**Goal**: During Phase 1, the dashboard shows the graph forming incrementally as Loom plans it.

**Independent Test**: Run `loomflo init` with dashboard open, verify nodes appear one by one.

### Implementation for User Story 8

- [x] T130 [US8] Implement spec_artifact_ready WebSocket event (broadcast as each spec artifact is generated during Phase 1) in packages/core/src/api/websocket.ts
- [x] T131 [US8] Implement incremental graph building events (emit graph_modified for each node/edge added during graph construction in spec engine) in packages/core/src/spec/spec-engine.ts
- [x] T132 [US8] Update GraphView component to handle incremental node/edge additions with animation in packages/dashboard/src/components/GraphView.tsx
- [x] T133 [US8] Update Graph page to show graph forming during Phase 1 with spec artifact status indicators in packages/dashboard/src/pages/Graph.tsx

**Checkpoint**: Dashboard shows graph building in real time during Phase 1.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: SDK, remaining CLI commands, Docker, documentation, end-to-end validation

- [ ] T134 [P] Implement SDK LoomfloClient class (connect, init, chat, status, onEvent, disconnect) in packages/sdk/src/client.ts
- [ ] T135 [P] Define and export all public SDK types in packages/sdk/src/types.ts
- [ ] T136 [P] Create SDK public exports (index.ts) in packages/sdk/src/index.ts
- [ ] T137 [P] Create core public exports (index.ts with all types and key classes) in packages/core/src/index.ts
- [ ] T138 Implement CLI `loomflo dashboard` command (open browser at daemon URL) in packages/cli/src/commands/dashboard.ts
- [ ] T139 Implement CLI `loomflo logs [node-id]` command (fetch and display agent logs) in packages/cli/src/commands/logs.ts
- [ ] T140 [P] Create Dockerfile (multi-stage build: build all packages, serve daemon + dashboard) in Dockerfile
- [ ] T141 [P] Create docker-compose.yml (daemon service with env vars and port mapping) in docker-compose.yml
- [ ] T142 Write end-to-end test (init → spec generation → confirm → execute 3-node linear graph → complete, using mock LLM provider) in packages/core/tests/integration/e2e.test.ts
- [ ] T143 Write README.md (architecture diagram in Mermaid, 3-command quickstart, real usage example, configuration reference, agent hierarchy diagram) in README.md
- [ ] T144 [P] Create LICENSE file (MIT) in LICENSE
- [ ] T145 Run quickstart.md validation (verify install → start → init works as documented) as manual verification

**Checkpoint**: All packages complete, tests pass, documentation ready. Tag v0.1.0.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — first user story, MVP
- **US2 (Phase 4)**: Depends on Foundational + partially on US1 (Loom agent shared) — can start after Foundational, but Loom agent from US1 is extended in US2
- **US3 (Phase 5)**: Depends on US2 (needs running workflow to display) — dashboard shell can start earlier
- **US4 (Phase 6)**: Depends on US1 (Loom agent) + API server from Foundational
- **US5+US9 (Phase 7)**: Depends on Foundational (config) + API routes
- **US6 (Phase 8)**: Depends on US2 (needs workflow execution to resume)
- **US7 (Phase 9)**: Depends on Foundational (cost tracker) + US3 (dashboard)
- **US8 (Phase 10)**: Depends on US1 (spec engine) + US3 (dashboard)
- **Polish (Phase 11)**: Depends on all user stories

### Recommended Execution Order

```text
Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1) → Phase 4 (US2)
                                                                   ↓
                                              Phase 5 (US3) + Phase 6 (US4) [parallel]
                                                         ↓
                                    Phase 7 (US5/9) + Phase 8 (US6) + Phase 9 (US7) + Phase 10 (US8) [parallel]
                                                         ↓
                                                  Phase 11 (Polish)
```

### Within Each User Story

- Models/types before services
- Services before API routes
- Core logic before CLI commands
- API routes before dashboard pages
- Implementation before tests (for this project, tests are written alongside)

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tool implementations (T027-T037) can run in parallel
- All Foundational test tasks (T043-T049) can run in parallel
- Dashboard components (T091-T096) can run in parallel
- US5/US6/US7/US8 can run in parallel once US3 dashboard shell exists
- SDK tasks (T134-T137) can run in parallel with Polish tasks

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (Spec Generation)
4. **STOP and VALIDATE**: Test init → spec generation → graph building
5. Tag as v0.1.0-alpha

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Spec generation works → Demo
3. Add US2 → Full execution works → Demo (this is the big one)
4. Add US3 → Dashboard monitoring → Demo
5. Add US4 → Chat works → Demo
6. Add US5-US9 → All features → Demo
7. Polish → v0.1.0 release

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story phase ends with a checkpoint for independent validation
- Tests are included per constitution mandate (60%+ coverage)
- File paths are relative to repository root
- Commit after each completed phase or logical group of tasks
