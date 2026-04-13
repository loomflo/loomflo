/**
 * Loomflo SDK public types.
 *
 * Standalone TypeScript definitions mirroring the core engine types.
 * Zero runtime dependencies — pure type declarations only.
 *
 * @packageDocumentation
 */

// ============================================================================
// Enums / Literal Unions
// ============================================================================

/** Workflow lifecycle state. */
export type WorkflowStatus =
  | "init"
  | "spec"
  | "building"
  | "running"
  | "paused"
  | "done"
  | "failed";

/** Node execution state. */
export type NodeStatus =
  | "pending"
  | "waiting"
  | "running"
  | "review"
  | "done"
  | "failed"
  | "blocked";

/** Agent role in the workflow hierarchy. */
export type AgentRole = "loom" | "loomi" | "looma" | "loomex";

/** Agent lifecycle state. */
export type AgentStatus = "created" | "running" | "completed" | "failed";

/** Graph topology classification. */
export type TopologyType = "linear" | "divergent" | "convergent" | "tree" | "mixed";

/** Event type identifier for the event log. */
export type EventType =
  | "workflow_created"
  | "workflow_started"
  | "workflow_paused"
  | "workflow_resumed"
  | "workflow_completed"
  | "spec_phase_started"
  | "spec_phase_completed"
  | "graph_built"
  | "graph_modified"
  | "node_started"
  | "node_completed"
  | "node_failed"
  | "node_blocked"
  | "agent_created"
  | "agent_completed"
  | "agent_failed"
  | "reviewer_started"
  | "reviewer_verdict"
  | "retry_triggered"
  | "escalation_triggered"
  | "message_sent"
  | "cost_tracked"
  | "memory_updated";

/** Review verdict from a Loomex reviewer agent. */
export type ReviewVerdict = "PASS" | "FAIL" | "BLOCKED";

/** LLM response stop reason. */
export type StopReason = "end_turn" | "tool_use";

// ============================================================================
// Simple Types
// ============================================================================

/** A directed edge between two nodes in the workflow graph. */
export interface Edge {
  /** Source node ID. */
  from: string;
  /** Target node ID. */
  to: string;
}

/** Per-task verification result from a Loomex review. */
export interface TaskVerification {
  /** Identifier of the verified task. */
  taskId: string;
  /** Task-level verification result. */
  status: "pass" | "fail" | "blocked";
  /** Explanation of what was found during verification. */
  details: string;
}

/** Cumulative token usage for an agent or LLM call. */
export interface TokenUsage {
  /** Number of input tokens consumed. */
  input: number;
  /** Number of output tokens produced. */
  output: number;
}

/** JSON-serializable tool definition sent to the LLM. */
export interface ToolDefinition {
  /** Tool identifier (e.g., "read_file"). */
  name: string;
  /** Human-readable description included in the LLM prompt. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: Record<string, unknown>;
}

/** A shared memory file managed by the daemon for cross-node state. */
export interface SharedMemoryFile {
  /** File name (e.g., "DECISIONS.md"). */
  name: string;
  /** Full path within .loomflo/shared-memory/. */
  path: string;
  /** Current file content (Markdown). */
  content: string;
  /** Agent ID that last wrote to this file. */
  lastModifiedBy: string;
  /** ISO 8601 timestamp of last modification. */
  lastModifiedAt: string;
}

// ============================================================================
// Medium Types
// ============================================================================

/** Metadata about an agent assigned to a workflow node. */
export interface AgentInfo {
  /** Unique agent identifier (e.g., "looma-auth-1"). */
  id: string;
  /** Agent role in the workflow. */
  role: AgentRole;
  /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
  model: string;
  /** Current agent lifecycle state. */
  status: AgentStatus;
  /** Glob patterns defining the agent's file write permissions. */
  writeScope: string[];
  /** Description of the agent's assigned task. */
  taskDescription: string;
  /** Cumulative token usage for this agent's LLM calls. */
  tokenUsage: TokenUsage;
  /** Cumulative cost in USD for this agent's LLM calls. */
  cost: number;
}

/** Structured review report produced by a Loomex reviewer agent. */
export interface ReviewReport {
  /** Overall review verdict. */
  verdict: ReviewVerdict;
  /** Per-task verification results. */
  tasksVerified: TaskVerification[];
  /** Detailed findings: what works, what's missing, what's blocked. */
  details: string;
  /** Specific recommended actions for retry or escalation. */
  recommendation: string;
  /** ISO 8601 timestamp when the review was produced. */
  createdAt: string;
}

/** An inter-agent message routed by the MessageBus within a node. */
export interface Message {
  /** Unique message identifier. */
  id: string;
  /** Sender agent ID. */
  from: string;
  /** Recipient agent ID. */
  to: string;
  /** Node context (messages are node-scoped). */
  nodeId: string;
  /** Message body. */
  content: string;
  /** ISO 8601 timestamp when the message was sent. */
  timestamp: string;
}

/** A single entry in the workflow event log (events.jsonl). */
export interface Event {
  /** ISO 8601 precise timestamp. */
  ts: string;
  /** Event type identifier. */
  type: EventType;
  /** Workflow this event belongs to. */
  workflowId: string;
  /** Node this event relates to, or null for workflow-level events. */
  nodeId: string | null;
  /** Agent this event relates to, or null for node/workflow-level events. */
  agentId: string | null;
  /** Event-specific payload data. */
  details: Record<string, unknown>;
}

// ============================================================================
// Complex Types
// ============================================================================

/** A workflow node representing one major step in the execution graph. */
export interface Node {
  /** Unique node identifier (e.g., "node-1"). */
  id: string;
  /** Human-readable node name (e.g., "Setup Authentication"). */
  title: string;
  /** Current node execution state. */
  status: NodeStatus;
  /** Markdown instructions for this node. */
  instructions: string;
  /** Delay before activation (e.g., "0", "30m", "1h", "1d"). */
  delay: string;
  /** ISO 8601 timestamp when the delay expires, or null. */
  resumeAt: string | null;
  /** Agents assigned to this node. */
  agents: AgentInfo[];
  /** Agent ID to glob patterns mapping for write scope enforcement. */
  fileOwnership: Record<string, string[]>;
  /** Number of retry cycles attempted. */
  retryCount: number;
  /** Maximum allowed retry cycles (from config). */
  maxRetries: number;
  /** Loomex review report, or null if no review has run. */
  reviewReport: ReviewReport | null;
  /** Total accumulated cost in USD for this node (including retries). */
  cost: number;
  /** ISO 8601 timestamp when the node started running, or null. */
  startedAt: string | null;
  /** ISO 8601 timestamp when the node finished, or null. */
  completedAt: string | null;
}

/** The directed acyclic graph defining workflow execution topology. */
export interface Graph {
  /** All nodes keyed by node ID. */
  nodes: Record<string, Node>;
  /** Directed edges connecting nodes. */
  edges: Edge[];
  /** Graph topology classification. */
  topology: TopologyType;
}

/** The top-level workflow entity representing a project being built. */
export interface Workflow {
  /** Unique workflow identifier. */
  id: string;
  /** Current workflow lifecycle state. */
  status: WorkflowStatus;
  /** Original natural language project description. */
  description: string;
  /** Absolute path to the project workspace. */
  projectPath: string;
  /** The directed execution graph. */
  graph: Graph;
  /** Merged configuration (global + project + CLI). */
  config: Config;
  /** ISO 8601 timestamp when the workflow was created. */
  createdAt: string;
  /** ISO 8601 timestamp of the last state change. */
  updatedAt: string;
  /** Accumulated cost in USD across all nodes. */
  totalCost: number;
}

// ============================================================================
// Configuration
// ============================================================================

/** Per-agent-role model configuration. */
export interface ModelConfig {
  /** Model for the Loom architect agent. */
  loom: string;
  /** Model for Loomi orchestrator agents. */
  loomi: string;
  /** Model for Looma worker agents. */
  looma: string;
  /** Model for Loomex reviewer agents. */
  loomex: string;
}

/** Retry strategy configuration. */
export interface RetryConfig {
  /** Maximum retries per node before escalation. */
  maxRetriesPerNode: number;
  /** Maximum retries per individual task. */
  maxRetriesPerTask: number;
  /** Retry strategy: "adaptive" adjusts prompts, "same" retries unchanged. */
  strategy: "adaptive" | "same";
}

/** Loomflo configuration (merged from global, project, and CLI sources). */
export interface Config {
  /** Per-role model assignments. */
  models: ModelConfig;
  /** Whether the Loomex reviewer is enabled. */
  reviewerEnabled: boolean;
  /** Default delay between node activations (e.g., "0", "30m"). */
  defaultDelay: string;
  /** Retry configuration. */
  retry: RetryConfig;
  /** Budget limit in USD (0 = unlimited). */
  budgetLimit: number;
  /** Dashboard port number. */
  dashboardPort: number;
  /** Daemon port number. */
  daemonPort: number;
  /** Max LLM API calls per minute per agent. */
  rateLimitPerAgent: number;
  /** Wall-clock timeout per agent call in seconds. */
  agentTimeout: number;
  /** Maximum tokens per agent call. */
  agentMaxTokens: number;
  /** Loomflo level (1=Minimal, 2=Standard, 3=Full). */
  level: 1 | 2 | 3;
  /** Whether shell execution sandbox is enabled. */
  sandboxEnabled: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

/** Workflow summary embedded in the health response. */
export interface HealthWorkflowSummary {
  /** Workflow identifier. */
  id: string;
  /** Current workflow status. */
  status: WorkflowStatus;
  /** Total number of nodes in the graph. */
  nodeCount: number;
  /** IDs of currently active (running) nodes. */
  activeNodes: string[];
}

/** Response from `GET /health`. */
export interface HealthResponse {
  /** Daemon status (e.g., "ok"). */
  status: string;
  /** Daemon uptime in seconds. */
  uptime: number;
  /** Daemon version string. */
  version: string;
  /** Active workflow summary, or null if no workflow. */
  workflow: HealthWorkflowSummary | null;
}

/** Response from `GET /workflow`. */
export interface WorkflowResponse {
  /** Workflow identifier. */
  id: string;
  /** Current workflow status. */
  status: WorkflowStatus;
  /** Original project description. */
  description: string;
  /** Absolute path to the project workspace. */
  projectPath: string;
  /** Accumulated total cost in USD. */
  totalCost: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last update timestamp. */
  updatedAt: string;
  /** The workflow graph structure. */
  graph: Graph;
}

/** Response from `POST /workflow/init`. */
export interface InitResponse {
  /** Created workflow identifier. */
  id: string;
  /** Initial workflow status. */
  status: WorkflowStatus;
  /** Echoed project description. */
  description: string;
}

/** Action taken by Loom in response to a chat message. */
export interface ChatAction {
  /** Type of action taken (e.g., "graph_modification", "instruction_relay"). */
  type: string;
  /** Action-specific detail data. */
  details: Record<string, unknown>;
}

/** Response from `POST /chat`. */
export interface ChatResponse {
  /** Loom's text response. */
  response: string;
  /** Action taken, or null if message was purely conversational. */
  action: ChatAction | null;
}

/** Single message in the chat history. */
export interface ChatMessage {
  /** Message role ("user" or "assistant"). */
  role: string;
  /** Message content. */
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Response from `GET /chat/history`. */
export interface ChatHistoryResponse {
  /** All chat messages exchanged with Loom. */
  messages: ChatMessage[];
}

/** Summary of a single node returned by `GET /nodes`. */
export interface NodeSummary {
  /** Node identifier. */
  id: string;
  /** Node title. */
  title: string;
  /** Current node status. */
  status: NodeStatus;
  /** Number of agents assigned. */
  agentCount: number;
  /** Accumulated cost in USD. */
  cost: number;
  /** Number of retry cycles completed. */
  retryCount: number;
}

/** Agent detail within a node detail response. */
export interface AgentDetail {
  /** Agent identifier. */
  id: string;
  /** Agent role. */
  role: AgentRole;
  /** Agent lifecycle state. */
  status: AgentStatus;
  /** Description of assigned task. */
  taskDescription: string;
  /** Glob patterns for write permissions. */
  writeScope: string[];
  /** Cumulative token usage. */
  tokenUsage: TokenUsage;
  /** Cumulative cost in USD. */
  cost: number;
}

/** Response from `GET /nodes/:id`. */
export interface NodeDetailResponse {
  /** Node identifier. */
  id: string;
  /** Node title. */
  title: string;
  /** Current node status. */
  status: NodeStatus;
  /** Markdown instructions for this node. */
  instructions: string;
  /** Delay string (e.g., "30m"). */
  delay: string;
  /** Number of retry cycles completed. */
  retryCount: number;
  /** Maximum allowed retries. */
  maxRetries: number;
  /** Accumulated cost in USD. */
  cost: number;
  /** ISO 8601 timestamp when the node started, or empty. */
  startedAt: string;
  /** Agents working in this node. */
  agents: AgentDetail[];
  /** Agent ID to glob patterns mapping. */
  fileOwnership: Record<string, string[]>;
}

/** Per-node cost entry in the costs response. */
export interface NodeCost {
  /** Node identifier. */
  id: string;
  /** Node title. */
  title: string;
  /** Total cost in USD. */
  cost: number;
  /** Number of retries (contributes to cost). */
  retries: number;
}

/** Response from `GET /costs`. */
export interface CostsResponse {
  /** Total workflow cost in USD. */
  total: number;
  /** Budget limit in USD (0 = unlimited). */
  budgetLimit: number;
  /** Remaining budget in USD. */
  budgetRemaining: number;
  /** Per-node cost breakdown. */
  nodes: NodeCost[];
  /** Cost attributed to the Loom architect agent. */
  loomCost: number;
}

/** Single event in the event log. */
export interface WorkflowEvent {
  /** ISO 8601 precise timestamp. */
  ts: string;
  /** Event type. */
  type: EventType;
  /** Related node ID, or null. */
  nodeId: string | null;
  /** Related agent ID, or null. */
  agentId: string | null;
  /** Event-specific payload. */
  details: Record<string, unknown>;
}

/** Response from `GET /events`. */
export interface EventsResponse {
  /** Matching events. */
  events: WorkflowEvent[];
  /** Total count of matching events (for pagination). */
  total: number;
}

/** Spec artifact metadata. */
export interface SpecArtifact {
  /** Artifact filename (e.g., "spec.md"). */
  name: string;
  /** Full file path. */
  path: string;
  /** File size in bytes. */
  size: number;
}

/** Response from `GET /specs`. */
export interface SpecsResponse {
  /** Available spec artifacts. */
  artifacts: SpecArtifact[];
}

/** Memory file metadata. */
export interface MemoryFile {
  /** File name (e.g., "DECISIONS.md"). */
  name: string;
  /** Full file path. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** ISO 8601 timestamp of last modification. */
  lastModified: string;
}

/** Response from `GET /memory`. */
export interface MemoryResponse {
  /** Available shared memory files. */
  files: MemoryFile[];
}

// ============================================================================
// WebSocket Event Types
// ============================================================================

/** Base WebSocket event with type discriminator. */
export interface WebSocketEvent {
  /** Event type discriminator. */
  type: string;
  /** Event-specific payload. */
  [key: string]: unknown;
}

/** WebSocket welcome event sent on connection. */
export interface ConnectedEvent extends WebSocketEvent {
  /** Always "connected". */
  type: "connected";
  /** Welcome message. */
  message: string;
}

/** WebSocket event for node status changes. */
export interface NodeStatusEvent extends WebSocketEvent {
  /** Always "node_status". */
  type: "node_status";
  /** Node identifier. */
  nodeId: string;
  /** New node status. */
  status: NodeStatus;
}

/** WebSocket event for agent status changes. */
export interface AgentStatusEvent extends WebSocketEvent {
  /** Always "agent_status". */
  type: "agent_status";
  /** Node identifier. */
  nodeId: string;
  /** Agent identifier. */
  agentId: string;
  /** Agent role. */
  role: AgentRole;
  /** New agent status. */
  status: AgentStatus;
}

/** WebSocket event for inter-agent messages. */
export interface AgentMessageEvent extends WebSocketEvent {
  /** Always "agent_message". */
  type: "agent_message";
  /** Node identifier. */
  nodeId: string;
  /** Sender agent ID. */
  from: string;
  /** Recipient agent ID. */
  to: string;
  /** Message content. */
  content: string;
}

/** WebSocket event for review verdicts. */
export interface ReviewVerdictEvent extends WebSocketEvent {
  /** Always "review_verdict". */
  type: "review_verdict";
  /** Node identifier. */
  nodeId: string;
  /** Review verdict. */
  verdict: ReviewVerdict;
  /** Reviewer details. */
  details: string;
}

/** WebSocket event for graph modifications. */
export interface GraphModifiedEvent extends WebSocketEvent {
  /** Always "graph_modified". */
  type: "graph_modified";
  /** Type of modification. */
  action: "add_node" | "remove_node" | "modify_node" | "add_edge" | "remove_edge";
  /** Modified node or edge data. */
  data: Record<string, unknown>;
}

/** WebSocket event for cost updates. */
export interface CostUpdateEvent extends WebSocketEvent {
  /** Always "cost_update". */
  type: "cost_update";
  /** Node identifier. */
  nodeId: string;
  /** Cost of this call in USD. */
  callCost: number;
  /** Total node cost in USD. */
  nodeCost: number;
  /** Total workflow cost in USD. */
  totalCost: number;
  /** Remaining budget in USD. */
  budgetRemaining: number;
}

/** WebSocket event for chat responses from Loom. */
export interface ChatResponseEvent extends WebSocketEvent {
  /** Always "chat_response". */
  type: "chat_response";
  /** Loom's response text. */
  response: string;
  /** Action taken, or null. */
  action: ChatAction | null;
}

/** WebSocket event for spec artifact readiness. */
export interface SpecArtifactReadyEvent extends WebSocketEvent {
  /** Always "spec_artifact_ready". */
  type: "spec_artifact_ready";
  /** Artifact name. */
  name: string;
  /** Artifact file path. */
  path: string;
}

// ============================================================================
// Client Options
// ============================================================================

/** Options for constructing a LoomfloClient. */
export interface LoomfloClientOptions {
  /** Daemon host. Defaults to "127.0.0.1". */
  host?: string;
  /** Daemon port. Defaults to 3000. */
  port?: number;
  /** Authentication token (required). */
  token: string;
}

/** Callback invoked when a WebSocket event of the subscribed type is received. */
export type EventCallback = (event: unknown) => void;
