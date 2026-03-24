# Data Model: Loomflo

**Date**: 2026-03-24

## Entities

### Workflow

The top-level entity representing a project being built.

| Field | Type | Description |
|-------|------|-------------|
| id | string (uuid) | Unique workflow identifier |
| status | WorkflowStatus | Current state: init, spec, building, running, paused, done, failed |
| description | string | Original natural language project description |
| projectPath | string | Absolute path to the project workspace |
| graph | Graph | The directed graph of nodes |
| config | Config | Merged configuration (global + project + CLI) |
| createdAt | ISO 8601 string | When the workflow was created |
| updatedAt | ISO 8601 string | Last state change timestamp |
| totalCost | number | Accumulated cost in USD |

**State transitions**:
```
init ──(loomflo init)──→ spec ──(specs generated)──→ building ──(graph built)──→ running
                                                                                    │
                                     ┌──────(budget hit / loomflo stop)─────────────┤
                                     ▼                                              │
                                   paused ──(resume)──→ running ──→ done
                                                          │
                                                          ▼
                                                        failed
```

### Graph

The directed graph defining execution topology.

| Field | Type | Description |
|-------|------|-------------|
| nodes | Map<string, Node> | All nodes keyed by ID |
| edges | Edge[] | Directed edges: { from: string, to: string } |
| topology | TopologyType | linear, divergent, convergent, tree, mixed |

**Validation rules**:
- Graph MUST be a DAG (directed acyclic graph). Cycles are rejected.
- Every node (except the first) MUST have at least one incoming edge.
- Orphan nodes (no incoming or outgoing edges, unless first or last) are rejected.

### Node

One major step in the workflow.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique node identifier (e.g., "node-1") |
| title | string | Human-readable name (e.g., "Setup Authentication") |
| status | NodeStatus | pending, waiting, running, review, done, failed, blocked |
| instructions | string | Markdown instructions for this node |
| delay | string | Delay before activation ("0", "30m", "1h", "1d") |
| resumeAt | ISO 8601 string \| null | When the delay expires (for persistence) |
| agents | AgentInfo[] | List of agents assigned to this node |
| fileOwnership | Record<string, string[]> | Agent ID → glob patterns for write scope |
| retryCount | number | How many retry cycles have been attempted |
| maxRetries | number | Max allowed retries (from config, default: 3) |
| reviewReport | ReviewReport \| null | Loomex's verdict (if reviewer ran) |
| cost | number | Total cost for this node (including retries) |
| startedAt | ISO 8601 string \| null | When the node started running |
| completedAt | ISO 8601 string \| null | When the node finished |

**State transitions**:
```
pending ──(predecessors done)──→ waiting ──(delay expires / delay=0)──→ running
                                                                          │
                                                    ┌─────────────────────┤
                                                    ▼                     ▼
                                                 review ──(PASS)──→    done
                                                    │
                                        ┌───────────┤
                                        ▼           ▼
                                  (FAIL, retries  (BLOCKED or
                                   remaining)      max retries)
                                        │           │
                                        ▼           ▼
                                     running      blocked/failed
                                  (retry cycle)   (escalate to Loom)
```

### AgentInfo

Metadata about an agent assigned to a node.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique agent identifier (e.g., "looma-auth-1") |
| role | AgentRole | loom, loomi, looma, loomex |
| model | string | LLM model to use (e.g., "claude-sonnet-4-6") |
| status | AgentStatus | created, running, completed, failed |
| writeScope | string[] | Glob patterns for file write access (Loomas only) |
| taskDescription | string | What this agent is working on |
| tokenUsage | { input: number, output: number } | Cumulative token usage |
| cost | number | Cumulative cost for this agent's LLM calls |

### ReviewReport

Structured output from Loomex.

| Field | Type | Description |
|-------|------|-------------|
| verdict | "PASS" \| "FAIL" \| "BLOCKED" | Overall result |
| tasksVerified | TaskVerification[] | Per-task status and details |
| details | string | What works, what's missing, what's blocked |
| recommendation | string | Specific actions for retry or escalation |
| createdAt | ISO 8601 string | When the review was produced |

### TaskVerification

Per-task result within a review report.

| Field | Type | Description |
|-------|------|-------------|
| taskId | string | Which task was verified |
| status | "pass" \| "fail" \| "blocked" | Task-level result |
| details | string | What was found |

### Event

A single entry in the event log (events.jsonl).

| Field | Type | Description |
|-------|------|-------------|
| ts | ISO 8601 string | Precise timestamp |
| type | EventType | Event type (see list below) |
| workflowId | string | Which workflow |
| nodeId | string \| null | Which node (null for workflow-level events) |
| agentId | string \| null | Which agent (null for node/workflow events) |
| details | Record<string, unknown> | Event-specific payload |

**Event types**: workflow_created, workflow_started, workflow_paused, workflow_resumed, workflow_completed, spec_phase_started, spec_phase_completed, graph_built, graph_modified, node_started, node_completed, node_failed, node_blocked, agent_created, agent_completed, agent_failed, reviewer_started, reviewer_verdict, retry_triggered, escalation_triggered, message_sent, cost_tracked, memory_updated

### Message

An inter-agent message routed by the MessageBus.

| Field | Type | Description |
|-------|------|-------------|
| id | string (uuid) | Unique message ID |
| from | string | Sender agent ID |
| to | string | Recipient agent ID |
| nodeId | string | Node context (messages are node-scoped) |
| content | string | Message body |
| timestamp | ISO 8601 string | When sent |

**Constraints**:
- Messages are only routable within the same node.
- Cross-node communication goes through shared memory.

### Config

Three-level configuration with per-node overrides.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| defaultDelay | string | "0" | Delay between nodes |
| reviewerEnabled | boolean | true | Enable Loomex |
| reviewerModel | string | "claude-sonnet-4-6" | Model for Loomex |
| maxRetriesPerNode | number | 3 | Max retry cycles per node |
| maxRetriesPerTask | number | 2 | Max retries per task |
| retryStrategy | "adaptive" \| "same" | "adaptive" | Prompt adaptation on retry |
| models.loom | string | "claude-opus-4-6" | Model for Architect |
| models.loomi | string | "claude-sonnet-4-6" | Model for Orchestrator |
| models.looma | string | "claude-sonnet-4-6" | Model for Workers |
| models.loomex | string | "claude-sonnet-4-6" | Model for Reviewer |
| provider | string | "anthropic" | LLM provider |
| budgetLimit | number \| null | null | Max cost in USD |
| pauseOnBudgetReached | boolean | true | Pause when budget hit |
| sandboxCommands | boolean | true | Sandbox shell exec |
| allowNetwork | boolean | false | Allow agent HTTP requests |
| dashboardPort | number | 3000 | Dashboard port |
| dashboardAutoOpen | boolean | true | Open browser on start |
| agentTimeout | number | 600000 | Wall-clock timeout per agent call (ms) |
| agentTokenLimit | number | 100000 | Max tokens per agent call |
| apiRateLimit | number | 60 | Max LLM calls per minute per agent |

**Resolution order**: Global (~/.loomflo/config.json) → Project (.loomflo/config.json) → CLI flags → Per-node overrides (workflow.json).

### Tool

A capability available to agents.

| Field | Type | Description |
|-------|------|-------------|
| name | string | Tool identifier (e.g., "read_file") |
| description | string | What the tool does (included in LLM prompt) |
| inputSchema | ZodSchema | Zod schema for input validation |
| execute | (input, context) → Promise<string> | Execution function returning result or error string |

**Available tools by agent role**:

| Tool | Loom | Loomi | Looma | Loomex |
|------|------|-------|-------|--------|
| read_file | yes | yes | yes | yes |
| write_file | no | no | yes | no |
| edit_file | no | no | yes | no |
| search_files | yes | yes | yes | yes |
| list_files | yes | yes | yes | yes |
| exec_command | no | no | yes | no |
| read_memory | yes | yes | yes | yes |
| write_memory | no | yes | yes | no |
| send_message | no | yes | yes | no |
| report_complete | no | no | yes | no |
| escalate | no | yes | no | no |

### SharedMemoryFile

A shared memory file managed by the daemon.

| Field | Type | Description |
|-------|------|-------------|
| name | string | File name (e.g., "DECISIONS.md") |
| path | string | Full path within .loomflo/shared-memory/ |
| content | string | Current file content (Markdown) |
| lastModifiedBy | string | Agent ID that last wrote to this file |
| lastModifiedAt | ISO 8601 string | Last modification timestamp |

**Standard files**: DECISIONS.md, ERRORS.md, PROGRESS.md, PREFERENCES.md, ISSUES.md, INSIGHTS.md, ARCHITECTURE_CHANGES.md

## Relationships

```text
Workflow 1──1 Graph
Graph 1──* Node
Graph 1──* Edge (from Node to Node)
Node 1──* AgentInfo
Node 0..1──1 ReviewReport
ReviewReport 1──* TaskVerification
Workflow 1──* Event
Workflow 1──1 Config
Node *──* SharedMemoryFile (read: all, write: serialized)
AgentInfo *──1 MessageBus (within same node only)
```
