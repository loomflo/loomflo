# Feature Specification: Loomflo — AI Agent Orchestration Framework

**Feature Branch**: `001-agent-orchestration-framework`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "Build Loomflo — an open-source AI Agent Orchestration Framework. A persistent daemon that takes natural language project descriptions and transforms them into finished products through interconnected nodes powered by AI agent teams."

## Clarifications

### Session 2026-03-24

- Q: What should `loomflo stop` do with in-progress agents? → A: Let active agent calls finish (no new calls dispatched), then stop immediately. The in-progress node is marked as interrupted for resume.
- Q: How should the system detect stuck/stalled agents? → A: Both wall-clock timeout AND per-call token cap. Whichever limit is hit first triggers agent failure and enters the retry/escalation flow.
- Q: What happens after the last node completes successfully? → A: Daemon stays running. Loom sends a completion message via the chat interface, writes a summary to shared memory, and awaits further instructions (e.g., "rerun node 3", "add a documentation node", "start a new project").
- Q: What is the difference between "pending" and "waiting" node status? → A: "Pending" = predecessors not yet complete (dependency-blocked). "Waiting" = predecessors done, node is eligible but delay timer is counting down. Dashboard shows pending nodes grayed out, waiting nodes with a visible countdown.
- Q: What is the event log and how does it differ from shared memory? → A: Separate structured append-only stream of all system events (agent lifecycle, node transitions, graph changes, errors, costs). Developer-facing: powers dashboard activity feed, `loomflo logs`, `loomflo status`, and resume logic. Distinct from shared memory, which is agent-facing semantic context in Markdown.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Spec Generation & Graph Planning (Priority: P1)

A developer runs `loomflo start` to launch the daemon, then runs `loomflo init "Build a REST API with auth and PostgreSQL"`. The system activates its Architect agent (Loom), which generates a complete specification suite:

1. **constitution.md** — non-negotiable quality principles for the target project
2. **spec.md** — functional specification (user stories, features, constraints, out-of-scope items). No technical implementation details. If ambiguity exists, Loom asks the user for clarification via the conversational interface (max 3 clarifications, then uses reasonable defaults for the rest).
3. **plan.md** — technical plan (stack, file structure, data model, architecture decisions)
4. **tasks.md** — ordered task list with file paths, parallelism flags, and user story associations
5. **analysis-report.md** — coherence analysis (coverage matrix, duplications, ambiguities, gaps, constitution violations)
6. **workflow.json** — the node graph: nodes, edges, topology, delays, per-node instructions, estimated cost

The developer reviews all artifacts and the graph in the dashboard, then confirms execution or requests adjustments.

**Why this priority**: This is the foundation. Without spec generation and graph planning, the system has no work to execute. Every other user story depends on a valid spec and graph existing.

**Independent Test**: Can be fully tested by running `loomflo start` and `loomflo init "..."`, then verifying that all 6 spec artifacts are produced, the graph is valid, and the user can review them before proceeding.

**Acceptance Scenarios**:

1. **Given** the daemon is running, **When** the user runs `loomflo init "Build a todo app"`, **Then** the system produces all 6 spec artifacts in the project's spec directory within a reasonable time and presents them for review.
2. **Given** the spec contains ambiguous points, **When** Loom detects them, **Then** Loom asks the user a maximum of 3 clarification questions via the conversational interface, using reasonable defaults for any remaining ambiguity.
3. **Given** the spec and graph are generated, **When** the user opens the dashboard, **Then** the user sees the full graph with nodes, edges, instructions, and estimated costs.
4. **Given** the user reviews the spec, **When** the user requests changes (e.g., "add a billing module"), **Then** Loom regenerates the affected artifacts and updates the graph accordingly.
5. **Given** the user is satisfied with the spec and graph, **When** the user confirms execution, **Then** the system transitions to Phase 2 (execution).

---

### User Story 2 — Workflow Execution (Priority: P2)

After the user confirms the spec and graph, the system executes the workflow node by node. For each node, an Orchestrator agent (Loomi) activates, reads its instructions, plans a team of Worker agents (Loomas), assigns each worker an exclusive set of files to write, and launches them in parallel. Workers write code, create files, run shell commands, and communicate with each other within the same node. When all workers report complete, an optional Reviewer agent (Loomex) inspects the output. On pass, the node completes and the workflow moves to the next node(s). On failure, the orchestrator retries with adapted prompts. On block, the orchestrator escalates to the Architect.

**Why this priority**: Execution is the core value delivery. Spec generation (US1) sets up the plan; execution produces the actual output. Without this, the system only plans but never builds.

**Independent Test**: Can be tested with a pre-built workflow.json containing a simple 3-node linear graph. Verify that each node activates in order, workers produce the expected files, the reviewer validates output, and the workflow completes.

**Acceptance Scenarios**:

1. **Given** a confirmed workflow with a linear graph (A → B → C), **When** execution starts, **Then** Node A activates first, completes, then Node B activates, completes, then Node C activates and completes.
2. **Given** a confirmed workflow with a divergent graph (A → [B, C]), **When** Node A completes, **Then** Nodes B and C activate and execute in parallel.
3. **Given** a confirmed workflow with a convergent graph ([B, C] → D), **When** both B and C complete, **Then** Node D activates.
4. **Given** a node with 3 workers, **When** the node activates, **Then** each worker receives an exclusive file write scope, and no two workers can write to the same file.
5. **Given** the reviewer is enabled and a worker produces incorrect output, **When** the reviewer returns FAIL, **Then** the orchestrator generates an adapted prompt incorporating the reviewer's feedback and relaunches only the failed workers.
6. **Given** a node has exhausted all retries, **When** the final retry fails, **Then** the orchestrator escalates to the Architect, which modifies the graph to work around the issue (add a node, move the task, or skip it with a logged error).
7. **Given** any failure or escalation scenario, **When** the system processes it, **Then** the workflow never deadlocks — it always progresses to completion or an explicit halt.

---

### User Story 3 — Real-Time Dashboard Monitoring (Priority: P3)

The developer opens a web dashboard (accessible at a configurable local port) and sees the workflow in real time: the node graph with statuses, agents activating and working, messages flowing between agents within nodes, the graph evolving (nodes added/removed/modified), costs accumulating per node and in total.

**Why this priority**: Visibility is critical for trust and debugging. Developers need to understand what's happening inside the system to intervene effectively. This is the primary observation interface.

**Independent Test**: Can be tested by starting the daemon, initiating a workflow, and opening the dashboard in a browser. Verify that node statuses update in real time, agent activity is visible, and cost counters increment.

**Acceptance Scenarios**:

1. **Given** a workflow is executing, **When** the developer opens the dashboard, **Then** the dashboard displays the full node graph with current status for each node (pending, waiting, running, done, failed, blocked).
2. **Given** a node is running, **When** the developer views that node, **Then** the dashboard shows which agents are active, what messages are being exchanged, and what files are being produced.
3. **Given** costs are accumulating, **When** the developer views the cost panel, **Then** the dashboard shows: tokens used per agent call, cost per node (including retries), total workflow cost, and budget remaining (if a budget is set).
4. **Given** the Architect modifies the graph during execution, **When** the modification occurs, **Then** the dashboard updates the graph visualization in real time.

---

### User Story 4 — Conversational Interface (Priority: P4)

The developer chats with the Architect agent (Loom) at any point — during spec generation or during execution — via `loomflo chat` in the terminal or the dashboard's chat panel. The developer can ask questions ("how is auth being implemented?"), give instructions ("use bcrypt for password hashing"), or request graph changes ("add a documentation node at the end"). Loom routes between conversation (answering a question) and action (modifying the graph, relaying instructions to an orchestrator). Chat history is persisted and viewable in the dashboard.

**Why this priority**: The conversational interface makes the system collaborative rather than fire-and-forget. It enables mid-course corrections and keeps the developer informed. However, the core value (spec + execution) must work first.

**Independent Test**: Can be tested by starting a workflow, sending a chat message via `loomflo chat`, and verifying the system responds appropriately (answers questions, takes actions, or requests clarification).

**Acceptance Scenarios**:

1. **Given** a workflow is executing, **When** the developer sends "how is authentication being implemented?", **Then** Loom responds with a summary of the relevant node's instructions and current status.
2. **Given** a workflow is executing, **When** the developer sends "use bcrypt not argon2 for password hashing", **Then** Loom relays the instruction to the relevant orchestrator, which updates its workers' context.
3. **Given** a workflow is executing, **When** the developer sends "add a documentation node at the end", **Then** Loom modifies the graph to insert a new node and confirms the change to the developer.
4. **Given** the developer sends a message during Phase 1 (spec generation), **When** Loom receives it, **Then** Loom incorporates the feedback into the spec artifacts.
5. **Given** messages have been exchanged, **When** the developer opens the dashboard chat panel, **Then** the full chat history is visible and scrollable.

---

### User Story 5 — Framework Configuration (Priority: P5)

The developer configures the framework to their needs before or during a workflow. Configuration operates at three levels: global defaults (apply to all projects), project-level config (override globals for this project), and CLI flags (one-time overrides). Per-node overrides are also supported in the workflow definition. The developer can disable the Reviewer for fast iterations, set delays between nodes for overnight builds, choose cheaper models for simple tasks, and set a budget limit.

**Why this priority**: Configuration is essential for adapting the framework to different use cases (fast prototyping vs. careful production builds). But the system must work with sensible defaults first.

**Independent Test**: Can be tested by modifying configuration values and verifying the system respects them (e.g., disable reviewer, verify no review step runs; set a delay, verify the delay is observed).

**Acceptance Scenarios**:

1. **Given** no configuration exists, **When** the user starts a workflow, **Then** the system uses sensible defaults (reviewer enabled, no delays, default models, no budget limit).
2. **Given** the user sets `reviewerEnabled: false` in project config, **When** a node completes, **Then** the system skips the review step and transitions directly to the next node.
3. **Given** the user sets `defaultDelay: "30m"`, **When** a node completes, **Then** the system waits 30 minutes before activating the next node.
4. **Given** the user sets `budgetLimit: 10` (USD), **When** the accumulated cost reaches $10, **Then** the system pauses the workflow and notifies the developer.
5. **Given** the user sets different models for different agent roles, **When** the workflow executes, **Then** each agent role uses its configured model.

---

### User Story 6 — Workflow Resume (Priority: P6)

The developer's daemon is interrupted (crash, manual stop, system restart). The developer runs `loomflo resume`. The daemon reloads the last workflow state from disk and continues execution from where it left off. Completed nodes are not re-executed. The currently active node restarts from scratch (agent state is not persisted across restarts).

**Why this priority**: Long-running workflows (hours, overnight builds) must survive interruptions. Without resume, any crash would require restarting the entire workflow from scratch, wasting time and money.

**Independent Test**: Can be tested by starting a multi-node workflow, killing the daemon mid-execution, running `loomflo resume`, and verifying that completed nodes are skipped and execution continues from the interrupted point.

**Acceptance Scenarios**:

1. **Given** a workflow was interrupted after nodes A and B completed and node C was in progress, **When** the developer runs `loomflo resume`, **Then** the system skips A and B and restarts node C from scratch.
2. **Given** no previous workflow state exists, **When** the developer runs `loomflo resume`, **Then** the system reports that there is nothing to resume.
3. **Given** the workflow was interrupted during Phase 1 (spec generation), **When** the developer runs `loomflo resume`, **Then** the system resumes spec generation from the last saved checkpoint.

---

### User Story 7 — Cost Monitoring (Priority: P7)

The developer monitors costs in real time. Every agent call tracks: tokens used (input + output), estimated cost (based on model pricing), and which node/agent generated it. Costs are aggregated per agent call, per node (including all retries), and as a running total. When a budget limit is configured, the remaining budget is shown. Costs are visible both in the dashboard and via `loomflo status` in the terminal.

**Why this priority**: AI agent workflows can be expensive. Cost transparency helps developers make informed decisions about model selection, retry limits, and when to stop. But the workflow must work first.

**Independent Test**: Can be tested by running a workflow and checking that `loomflo status` reports accurate token counts and costs per node, and that the dashboard cost panel matches.

**Acceptance Scenarios**:

1. **Given** a workflow is executing, **When** the developer runs `loomflo status`, **Then** the output shows per-node costs, total cost, and budget remaining (if configured).
2. **Given** a node required 2 retries, **When** the developer views that node's cost, **Then** the cost includes all 3 attempts (initial + 2 retries).
3. **Given** a budget limit is set and the cost reaches the limit, **When** the threshold is hit, **Then** the system pauses execution and notifies the developer via both the dashboard and CLI.

---

### User Story 8 — Real-Time Graph Building (Priority: P8)

During Phase 1, as Loom plans the workflow, the developer sees the node graph build in real time in the dashboard. Nodes appear one by one as Loom creates them, with their instructions, connections to other nodes, and estimated costs visible as soon as they are defined. This gives the developer visibility into Loom's planning process before the graph is finalized.

**Why this priority**: Watching the graph form helps the developer catch misunderstandings early — before execution begins rather than after. But it's a visualization enhancement; the system functions without it.

**Independent Test**: Can be tested by running `loomflo init "..."` with the dashboard open and verifying that nodes appear incrementally in the graph view.

**Acceptance Scenarios**:

1. **Given** the user runs `loomflo init "..."`, **When** Loom begins constructing the graph, **Then** the dashboard shows nodes appearing one at a time as they are planned.
2. **Given** Loom adds an edge between two nodes, **When** the edge is created, **Then** the dashboard immediately draws the connection.
3. **Given** Loom revises a previously planned node, **When** the revision happens, **Then** the dashboard updates the node's details in place.

---

### User Story 9 — Mid-Execution Configuration Changes (Priority: P9)

The developer modifies configuration while the workflow is executing. They can change the delay for the next node, disable the Reviewer for a specific node, switch to a cheaper model for the remaining nodes, or adjust the budget limit — all via `loomflo config set <key> <value>` or the dashboard configuration panel. Changes take effect for the next node activation (in-progress nodes complete with their original settings).

**Why this priority**: Flexibility during execution avoids the need to stop, reconfigure, and restart. But it's an optimization over the base configuration system (US5).

**Independent Test**: Can be tested by starting a multi-node workflow, changing a config value mid-execution (e.g., disable reviewer), and verifying the next node respects the change while the current node is unaffected.

**Acceptance Scenarios**:

1. **Given** a workflow is executing node B (of A → B → C), **When** the developer runs `loomflo config set reviewerEnabled false`, **Then** node B completes with its reviewer, but node C skips the review step.
2. **Given** a workflow is executing, **When** the developer changes the model for a specific agent role via the dashboard, **Then** the next node uses the new model for that role.
3. **Given** a workflow is executing, **When** the developer increases the budget limit, **Then** a paused workflow resumes automatically if the new limit exceeds the current cost.

---

### Edge Cases

- What happens when the LLM provider is temporarily unavailable during an agent call? The system retries the API call with exponential backoff (configurable max retries). If the provider remains unavailable after all retries, the node is marked as blocked and the orchestrator escalates to the Architect.
- What happens when the budget limit is reached in the middle of a node's execution? The system completes the currently active agent calls (to avoid leaving files in a half-written state), then pauses the workflow and notifies the developer.
- What happens when two workers in the same node need to modify the same file? The File Ownership System prevents this by design — write scopes MUST NOT overlap. If a worker discovers it needs to write outside its scope, it requests permission from its orchestrator, which either grants a temporary lock or redirects the request to the responsible worker.
- What happens when the developer runs `loomflo stop` during execution? The system stops dispatching new agent calls but lets currently active calls finish to avoid half-written files. The in-progress node is marked as interrupted. On `loomflo resume`, that node restarts from scratch.
- What happens when the daemon receives a `loomflo init` while a workflow is already active? The system rejects the command with an error: "A workflow is already active. Use `loomflo stop` to terminate the current workflow first."
- What happens when the developer sends contradictory instructions via chat (e.g., "use bcrypt" then "use argon2")? Loom applies the most recent instruction and logs the change in shared memory. The developer can see the history of preference changes.
- What happens when the Architect's graph modification creates an invalid topology (e.g., a cycle)? The system validates all graph modifications before applying them. Invalid topologies are rejected and logged as errors.
- What happens when a project description is extremely vague (e.g., "build something cool")? Loom generates the best possible spec from what it has, then asks up to 3 targeted clarification questions. If the description remains too vague after clarifications, Loom produces a minimal viable spec with documented assumptions and proceeds.
- What happens during `loomflo resume` if spec artifacts were partially written? The system detects incomplete artifacts, regenerates any that are corrupted or incomplete, and then proceeds with execution.
- What happens if an agent attempts to execute a shell command that accesses files outside the project workspace? The sandbox detects the path traversal and rejects the command. The agent receives a structured error message explaining the violation.
- What happens when a worker agent is stuck (hanging API call or infinite reasoning loop)? The system enforces both a wall-clock timeout and a per-call token cap. Whichever limit is hit first terminates the agent and marks it as failed, entering the standard retry/escalation flow.

## Requirements *(mandatory)*

### Functional Requirements

**Daemon Lifecycle**

- **FR-001**: System MUST run as a persistent background process that accepts commands from a thin CLI client and a web dashboard.
- **FR-002**: System MUST persist all workflow state to disk so it survives process restarts.
- **FR-003**: System MUST resume an interrupted workflow from the last completed node when the developer runs `loomflo resume`.
- **FR-004**: System MUST support exactly one active workflow per daemon instance (v1 scope).
- **FR-004a**: When the developer runs `loomflo stop`, the system MUST allow currently active agent calls to finish (no new calls dispatched), then stop the daemon. The in-progress node MUST be marked as interrupted so `loomflo resume` restarts it from scratch.
- **FR-004b**: When the last node completes successfully, the daemon MUST remain running. Loom MUST send a completion message via the chat interface, write a workflow summary to shared memory, and remain available for further instructions (e.g., rerun a node, add new nodes, start a new project).

**Spec Generation (Phase 1)**

- **FR-005**: System MUST accept a natural language project description via `loomflo init "<description>"` and produce a complete specification suite.
- **FR-006**: The specification suite MUST include: constitution.md, spec.md, plan.md, tasks.md, analysis-report.md, and workflow.json.
- **FR-007**: The Architect MUST ask the user a maximum of 3 clarification questions for ambiguous points, using reasonable defaults for the rest.
- **FR-008**: The user MUST be able to review and modify the spec and graph before confirming execution.
- **FR-009**: All spec artifacts MUST be persisted in the project directory and serve as context for all agents during execution.

**Workflow Execution (Phase 2)**

- **FR-010**: System MUST execute the workflow according to graph topology, supporting linear, divergent, convergent, tree, and mixed topologies.
- **FR-011**: For each node, the system MUST assign an Orchestrator that plans a team of Workers with exclusive file write scopes.
- **FR-012**: Worker write scopes MUST NOT overlap. All workers MUST have read access to all project files.
- **FR-013**: Workers within the same node MUST be able to communicate with each other via an in-process message channel.
- **FR-014**: Cross-node communication MUST go through shared memory files managed by the daemon.
- **FR-015**: The daemon MUST serialize all shared memory writes to prevent race conditions.
- **FR-016**: When the optional Reviewer is enabled, it MUST inspect all node output and produce a verdict: PASS, FAIL, or BLOCKED.
- **FR-017**: On FAIL, the Orchestrator MUST retry with adapted prompts incorporating the Reviewer's feedback, relaunching only the failed workers.
- **FR-018**: On BLOCKED (or after max retries exhausted), the Orchestrator MUST escalate to the Architect.
- **FR-019**: The Architect MUST be able to modify the graph to work around failures (add, remove, or modify nodes). The workflow MUST never deadlock.
- **FR-020**: Retries MUST be configurable: max retries per node (default: 3), max retries per task (default: 2), retry strategy ("adaptive" or "same").
- **FR-020a**: The system MUST enforce a configurable wall-clock timeout per agent call. If an agent exceeds the timeout, it MUST be terminated and marked as failed.
- **FR-020b**: The system MUST enforce a configurable token budget per agent call. If an agent exceeds its token allocation, it MUST be stopped and marked as failed.
- **FR-020c**: Both timeout and token cap are checked concurrently; whichever is hit first triggers the failure. Failed agents enter the standard retry/escalation flow.

**Self-Modifying Graph**

- **FR-021**: During execution, the Architect MUST be able to insert, remove, or modify future nodes in the graph.
- **FR-022**: All graph modifications MUST be logged in shared memory and visible in the dashboard.
- **FR-023**: The Architect MUST monitor shared memory asynchronously and react to critical issues without waiting for formal escalation.

**Conversational Interface**

- **FR-024**: Users MUST be able to chat with the Architect via `loomflo chat` (CLI) and the dashboard chat panel during both phases.
- **FR-025**: The Architect MUST route user messages to the appropriate action: answer a question, relay an instruction to an Orchestrator, or modify the graph.
- **FR-026**: Chat history MUST be persisted and accessible in the dashboard.

**Dashboard**

- **FR-027**: System MUST provide a web-based dashboard accessible at a configurable local port (default: 3000).
- **FR-028**: Dashboard MUST display: node graph with statuses, agent activity, message flow, shared memory contents, costs, and configuration.
- **FR-029**: Dashboard MUST update in real time as the workflow progresses.
- **FR-030**: During Phase 1, the dashboard MUST show the graph forming incrementally as the Architect plans it.

**Configuration**

- **FR-031**: System MUST support three-level configuration: global defaults, project config, CLI flags (each overrides the previous).
- **FR-032**: Per-node configuration overrides MUST be supported in the workflow definition.
- **FR-033**: Configurable parameters MUST include: agent models, delays, retry strategy, reviewer toggle, budget limit, sandbox settings, dashboard port.
- **FR-034**: Configuration changes during execution MUST take effect for the next node activation (in-progress nodes are unaffected).

**Cost Monitoring**

- **FR-035**: System MUST track token usage (input + output) and estimated cost for every agent call.
- **FR-036**: Costs MUST be aggregated per agent call, per node (including retries), and as a running workflow total.
- **FR-037**: When a budget limit is configured, the system MUST pause the workflow when the cost threshold is reached and notify the developer.
- **FR-038**: Cost data MUST be visible via `loomflo status` and the dashboard cost panel.

**SDK / API**

- **FR-039**: System MUST expose its functionality via a local API that external tools can consume.
- **FR-040**: System MUST be distributable as a package that other tools can use programmatically.

**Security**

- **FR-041**: Each project MUST run in its own isolated workspace directory. Agents MUST NOT access files outside the project workspace.
- **FR-042**: Shell commands executed by agents MUST be sandboxed to the project workspace. Path traversal attempts MUST be detected and rejected.
- **FR-043**: Credentials (LLM API keys) MUST be loaded from environment variables only. They MUST NEVER be hardcoded, logged, or written to any file.
- **FR-044**: The daemon MUST listen on localhost only. API access MUST be protected by an auto-generated token.
- **FR-045**: Each agent's file write permissions MUST be enforced by the daemon before any filesystem operation.

**Event Log**

- **FR-045a**: The system MUST maintain a structured, append-only event log recording all system events: agent lifecycle (start, stop, fail), node state transitions, graph modifications, errors, retries, cost entries, and chat messages.
- **FR-045b**: The event log MUST be developer-facing and power the dashboard activity feed, `loomflo logs`, `loomflo status`, and the resume logic.
- **FR-045c**: The event log MUST be distinct from shared memory. Shared memory contains agent-facing semantic context in Markdown. The event log contains machine-readable structured events with precise timestamps.

**Agent Hierarchy**

- **FR-046**: The agent hierarchy MUST be strictly defined: Architect (1 per project) → Orchestrator (1 per node) → Workers (N per node) + optional Reviewer (1 per node).
- **FR-047**: Workers MUST NOT create sub-agents. If a task is too large, the Orchestrator must create more Workers with more granular tasks.
- **FR-048**: Only the Orchestrator can escalate to the Architect. The Reviewer reports only to the Orchestrator.

### Key Entities

- **Workflow**: A project managed by the system. Contains a graph of nodes, shared memory, spec artifacts, configuration, and an event log. One active workflow per daemon instance (v1).
- **Node**: One major step of the project. Has markdown instructions, a team of agents, a configurable delay before execution, outputs, and a status:
  - **pending**: predecessors not yet complete (dependency-blocked)
  - **waiting**: predecessors done, delay timer counting down (eligible but not yet activated)
  - **running**: actively executing (agents working)
  - **review**: Loomex inspecting output (if reviewer enabled)
  - **done**: completed successfully
  - **failed**: exhausted all retries without success
  - **blocked**: deemed impossible, escalated to Architect
- **Graph**: The directed graph of nodes that defines the execution topology and order. Supports linear, divergent, convergent, tree, and mixed topologies.
- **Loom (Architect)**: The top-level agent (1 per project). Generates specs, manages the graph, interfaces with the user, monitors shared memory, and handles escalations. Does NOT write project code directly.
- **Loomi (Orchestrator)**: One per node. Plans the worker team, assigns file scopes, supervises workers, handles retries, and escalates to Loom when needed. Does NOT write project code directly.
- **Looma (Worker)**: Worker agent within a node (N per node). Has a role, a structured prompt, tools, and an exclusive file write scope. Does the actual work: writes code, creates files, runs commands. Workers within the same node communicate via the message channel.
- **Loomex (Reviewer)**: Optional agent per node (1 per node when enabled). Inspects work quality against node instructions. Produces a structured verdict (PASS/FAIL/BLOCKED) with detailed findings. Does NOT modify project files.
- **Shared Memory**: A set of persisted Markdown files shared across all nodes, containing decisions, errors, progress, preferences, issues, insights, and architecture changes. Agent-facing semantic context written in natural language. All writes are serialized by the daemon to prevent race conditions.
- **Event Log**: A structured, append-only stream of all system events (agent lifecycle, node transitions, graph modifications, errors, cost entries, chat messages). Developer-facing: powers the dashboard activity feed, `loomflo logs`, `loomflo status`, and resume logic. Machine-readable with precise timestamps. Distinct from shared memory.
- **Tool**: A capability given to an agent. Each tool has a name, description, input definition, and produces a string result (or structured error). Tools are the only way agents interact with the outside world.
- **Configuration**: Three-level system (global → project → CLI flags) with per-node overrides. Controls models, delays, retries, budgets, reviewer toggle, sandbox settings, and dashboard port.

## Assumptions

- v1 supports exactly one active workflow per daemon instance. Multi-project support is out of scope.
- The daemon runs on localhost only. There is no multi-user authentication — it is a single-user tool.
- v1 ships with one LLM provider (Anthropic Claude). The provider interface is designed for extensibility, but additional providers are out of scope.
- The system does not manage git operations (commit, push, branch). The developer manages their own version control.
- Agents are ephemeral: created when a node activates and destroyed when the node completes. There is no agent persistence across nodes.
- The dashboard is a monitoring and configuration interface only. There is no visual graph editor (drag-and-drop node creation).
- The system writes files to disk in the project workspace. It does not provide browser-based code editing.
- Cost estimates are based on published model pricing and token counts. Actual billing may vary slightly based on provider-specific rounding.
- The standard agent prompt format uses structured sections (role, task, context, reasoning, stop conditions, output) for consistency across all agent types.
- Network access for agents is disabled by default. When enabled via configuration, agents can make outbound HTTP requests.

## Out of Scope (v1)

- Multi-project: only one active workflow per daemon instance
- Multi-user / authentication: single-user, localhost daemon
- Web deployment / hosting of generated projects
- Visual graph editor (drag & drop nodes)
- Plugin / extension marketplace
- Automatic git integration (auto-commit, auto-push)
- Agent persistence across nodes
- Browser-based code editing
- Non-Anthropic LLM providers (interface ready, implementations deferred)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from a natural language description to a complete, reviewed specification suite and execution graph in a single interactive session.
- **SC-002**: A multi-node workflow (5+ nodes) with mixed topology completes end-to-end without human intervention, producing working project files.
- **SC-003**: The review-and-retry cycle catches and fixes at least 70% of worker errors within the configured retry limit, without requiring developer intervention.
- **SC-004**: An interrupted workflow resumes from the last completed node within 30 seconds of running `loomflo resume`, without re-executing completed work.
- **SC-005**: The dashboard displays node status updates, agent activity, and cost changes within 2 seconds of the underlying event occurring.
- **SC-006**: The conversational interface responds to developer questions and instructions within the expected latency of the underlying LLM call, and correctly routes between "answer" and "action" at least 90% of the time.
- **SC-007**: The File Ownership System prevents 100% of write-scope violations — no two agents ever write to the same file concurrently.
- **SC-008**: Cost tracking reports are accurate to within 5% of actual provider billing for token-based costs.
- **SC-009**: A developer with no prior Loomflo experience can install, start the daemon, and run their first `loomflo init` in 3 commands or fewer.
- **SC-010**: The system can be installed and run from a clean clone with `pnpm install && pnpm build` and zero additional manual steps.
