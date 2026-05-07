// ============================================================================
// Dashboard Mirror Types
//
// Pure TypeScript interfaces mirroring @loomflo/core types.
// No runtime dependencies — no zod, no imports from @loomflo/core.
//
// When the daemon adds or renames a route field, update the corresponding
// interface here. The dashboard MUST NOT import from @loomflo/core so it
// can build independently.
// ============================================================================

// ============================================================================
// Enums / Union Types
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
  | "blocked"
  | "waiting_for_provider"
  | "failed_provider_exhausted";

/** Agent role: loom (architect), loomi (orchestrator), looma (worker), loomex (reviewer). */
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

/** Review verdict from Loomex. */
export type ReviewVerdict = "PASS" | "FAIL" | "BLOCKED";

/** Task-level verification result. */
export type TaskVerificationStatus = "pass" | "fail" | "blocked";

/** Level preset selector. */
export type Level = 1 | 2 | 3 | "custom";

/** Retry strategy: 'adaptive' modifies the prompt on retry, 'same' retries as-is. */
export type RetryStrategy = "adaptive" | "same";

// ============================================================================
// Simple Types
// ============================================================================

/** A directed edge between two nodes in the workflow graph. */
export interface Edge {
  from: string;
  to: string;
}

/** Per-task verification result from a Loomex review. */
export interface TaskVerification {
  taskId: string;
  status: TaskVerificationStatus;
  details: string;
}

/** Cumulative token usage for an agent. */
export interface TokenUsage {
  input: number;
  output: number;
}

// ============================================================================
// Medium Types
// ============================================================================

/** Structured review report produced by a Loomex reviewer agent. */
export interface ReviewReport {
  verdict: ReviewVerdict;
  tasksVerified: TaskVerification[];
  details: string;
  recommendation: string;
  createdAt: string;
}

/** Metadata about an agent assigned to a workflow node. */
export interface AgentInfo {
  id: string;
  role: AgentRole;
  model: string;
  status: AgentStatus;
  writeScope: string[];
  taskDescription: string;
  tokenUsage: TokenUsage;
  cost: number;
}

/** Persisted provider retry state for rate-limit backoff. */
export interface ProviderRetryState {
  attempt: number;
  resumeAt: string | null;
  lastStatusCode: number | null;
  lastReason: string | null;
}

// ============================================================================
// Complex Types
// ============================================================================

/** A workflow node representing one major step in the execution graph. */
export interface Node {
  id: string;
  title: string;
  status: NodeStatus;
  instructions: string;
  delay: string;
  resumeAt: string | null;
  agents: AgentInfo[];
  fileOwnership: Record<string, string[]>;
  retryCount: number;
  maxRetries: number;
  reviewReport: ReviewReport | null;
  cost: number;
  startedAt: string | null;
  completedAt: string | null;
  /** Provider retry state for rate-limit backoff, or null if not in retry. */
  providerRetryState?: ProviderRetryState | null;
  /** Agent runtime to execute this node. */
  runtime?: RuntimeName;
}

/** The directed acyclic graph defining workflow execution topology. */
export interface Graph {
  nodes: Record<string, Node>;
  edges: Edge[];
  topology: TopologyType;
}

/** Per-role model configuration mapping agent roles to LLM model identifiers. */
export interface ModelsConfig {
  loom: string;
  loomi: string;
  looma: string;
  loomex: string;
}

/** Full Loomflo configuration with all fields resolved. */
export interface Config {
  level: Level;
  defaultDelay: string;
  reviewerEnabled: boolean;
  maxRetriesPerNode: number;
  maxRetriesPerTask: number;
  maxLoomasPerLoomi: number | null;
  retryStrategy: RetryStrategy;
  models: ModelsConfig;
  provider: string;
  budgetLimit: number | null;
  pauseOnBudgetReached: boolean;
  sandboxCommands: boolean;
  allowNetwork: boolean;
  dashboardPort: number;
  dashboardAutoOpen: boolean;
  agentTimeout: number;
  agentTokenLimit: number;
  apiRateLimit: number;
}

/** The top-level workflow entity representing a project being built. */
export interface Workflow {
  id: string;
  status: WorkflowStatus;
  description: string;
  projectPath: string;
  graph: Graph;
  config: Config;
  createdAt: string;
  updatedAt: string;
  totalCost: number;
}

/** A single entry in the workflow event log (events.jsonl). */
export interface Event {
  ts: string;
  type: EventType;
  workflowId: string;
  nodeId: string | null;
  agentId: string | null;
  details: Record<string, unknown>;
}

// ============================================================================
// Cost Tracking
// ============================================================================

/** A single cost ledger entry for an LLM API call. */
export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  agentId: string;
  nodeId: string;
  timestamp: string;
}

/** Aggregated cost summary across all entries. */
export interface CostSummary {
  entries: CostEntry[];
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/** Per-node cost entry returned by GET /costs. */
export interface CostNodeEntry {
  id: string;
  title: string;
  cost: number;
  retries: number;
}

/** Shape of GET /projects/:id/costs. */
export interface CostsResponse {
  total: number;
  budgetLimit: number | null;
  budgetRemaining: number | null;
  nodes: CostNodeEntry[];
  loomCost: number;
}

// ============================================================================
// Project Types
// ============================================================================

/** Summary of a project returned by the list endpoint. */
export interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
  status: "idle" | "running" | "blocked" | "failed" | "completed";
  startedAt: string;
  cost: number;
  currentNodeId: string | null;
}

/** Detailed project info including its workflow ref. */
export type ProjectDetail = ProjectSummary;

/** Body for POST /projects. */
export interface CreateProjectBody {
  /** Must match `proj_[0-9a-f]{8}`. */
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
  configOverrides?: Record<string, unknown>;
}

// ============================================================================
// Chat Types
// ============================================================================

/** Body for POST /projects/:id/chat (single message form). */
export interface ChatBody {
  message: string;
}

/** Response from POST /chat. */
export interface ChatResponse {
  response: string;
  action: { type: string; details: Record<string, unknown> } | null;
  category: string;
}

/** Single entry in GET /chat/history. */
export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// ============================================================================
// Memory & Specs
// ============================================================================

/** A single shared memory file in the list response. */
export interface MemoryFileEntry {
  name: string;
  lastModifiedBy: string;
  lastModifiedAt: string;
}

/** Shape of GET /memory. */
export interface Memory {
  files: MemoryFileEntry[];
}

/** A single spec artifact. */
export interface SpecArtifact {
  name: string;
  path: string;
  size: number;
}

/** Shape of GET /specs. */
export interface Specs {
  artifacts: SpecArtifact[];
}

// ============================================================================
// Workflow init / start responses
// ============================================================================

/** Body for POST /workflow/init. */
export interface InitWorkflowBody {
  description: string;
  projectPath: string;
  config?: Partial<Config>;
}

/** Response from POST /workflow/init. */
export interface InitResponse {
  id: string;
  status: string;
  description: string;
}

/** Response from POST /workflow/start, /pause, /resume. */
export interface StartResponse {
  status: string;
}

// ============================================================================
// Daemon, runtime, credentials, MCP
// ============================================================================

/** Daemon health endpoint. */
export interface HealthResponse {
  ok: boolean;
  uptime: number;
}

/** Daemon /status endpoint. */
export interface DaemonStatusResponse {
  port: number;
  pid: number;
  version: string;
  uptimeMs: number;
  projectCount: number;
}

/** Runtime registry name. */
export type RuntimeName = "loomi-native" | "claude-agent" | "copilot" | "mock";

/** Agent CLI name (subset of runtimes that depend on a local CLI). */
export type AgentCliName = "claude-code" | "copilot" | "codex";

/** Per-runtime capability flags exposed by /runtimes. */
export interface RuntimeCapabilities {
  supportsMcp?: boolean;
  supportsCanUseTool?: boolean;
  supportsSessionPersistence?: boolean;
  supportsStreaming?: boolean;
  supportsSubagents?: boolean;
  supportsByokProvider?: boolean;
}

/** Listed runtime entry exposed by GET /runtimes. */
export interface RuntimeListEntry {
  name: RuntimeName;
  displayName: string;
  registered: boolean;
  capabilities?: RuntimeCapabilities;
  cli?: AgentCliName;
}

/** CLI presence + auth state, returned by /runtimes/:name/availability and /runtimes/availability. */
export interface CliAvailability {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  path?: string;
}

/** Model entry returned by /runtimes/:name/models. */
export interface ModelInfo {
  id: string;
  displayName: string;
  provider: string;
  available: boolean;
  contextTokens?: number;
}

/** Credential profile type discriminator. */
export type CredentialType =
  | "anthropic-oauth"
  | "anthropic"
  | "openai"
  | "moonshot"
  | "nvidia";

/** Public/redacted shape of a saved credential profile. */
export type RedactedProfile =
  | { name: string; type: "anthropic-oauth" }
  | { name: string; type: "anthropic"; apiKeyPreview: string }
  | {
      name: string;
      type: "openai" | "moonshot" | "nvidia";
      apiKeyPreview: string;
      baseUrl?: string;
      defaultModel?: string;
    };

/** Body for PUT /credentials/:name. */
export type ProviderProfilePayload =
  | { type: "anthropic-oauth" }
  | { type: "anthropic"; apiKey: string }
  | {
      type: "openai" | "moonshot" | "nvidia";
      apiKey: string;
      baseUrl?: string;
      defaultModel?: string;
    };

/** MCP server configuration entry. */
export interface McpServerConfigEntry {
  type: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

// ============================================================================
// WebSocket event surface (mirrors api/websocket.ts)
// ============================================================================

/** Event kind discriminator for daemon-side WS events. */
export type WsEventType =
  | "node_status"
  | "agent_status"
  | "agent_message"
  | "review_verdict"
  | "graph_modified"
  | "cost_update"
  | "chat_response"
  | "spec_artifact_ready"
  | "memory_updated"
  | "runtime_session_started"
  | "runtime_session_event"
  | "mcp_tool_called";

/** Common base. */
interface WsEventBase {
  type: WsEventType;
  timestamp: string;
  /** Set when the daemon broadcasts via {@code broadcastForProject}. */
  projectId?: string;
}

export interface WsNodeStatusEvent extends WsEventBase {
  type: "node_status";
  nodeId: string;
  status: NodeStatus;
  details?: Record<string, unknown>;
}

export interface WsAgentStatusEvent extends WsEventBase {
  type: "agent_status";
  nodeId: string;
  agentId: string;
  status: AgentStatus;
  details?: Record<string, unknown>;
}

export interface WsAgentMessageEvent extends WsEventBase {
  type: "agent_message";
  nodeId: string;
  agentId: string;
  message: string;
}

export interface WsReviewVerdictEvent extends WsEventBase {
  type: "review_verdict";
  nodeId: string;
  verdict: ReviewVerdict;
  report: ReviewReport;
}

export type GraphAction =
  | "node_added"
  | "node_removed"
  | "node_modified"
  | "edge_added"
  | "edge_removed";

export interface WsGraphModifiedEvent extends WsEventBase {
  type: "graph_modified";
  action: GraphAction;
  nodeId?: string;
  details?: Record<string, unknown>;
}

export interface WsCostUpdateEvent extends WsEventBase {
  type: "cost_update";
  nodeId: string;
  callCost: number;
  nodeCost: number;
  totalCost: number;
  budgetRemaining?: number;
}

export interface WsChatAction {
  type: string;
  details: Record<string, unknown>;
}

export interface WsChatResponseEvent extends WsEventBase {
  type: "chat_response";
  response: string;
  category: string;
  action: WsChatAction | null;
}

export interface WsSpecArtifactReadyEvent extends WsEventBase {
  type: "spec_artifact_ready";
  name: string;
  path: string;
}

export interface WsMemoryUpdatedEvent extends WsEventBase {
  type: "memory_updated";
  file: string;
  summary: string;
  agentId?: string;
}

export interface WsRuntimeSessionStartedEvent extends WsEventBase {
  type: "runtime_session_started";
  nodeId: string;
  agentId: string;
  runtimeName: string;
  sessionId: string;
  model?: string;
}

export interface WsRuntimeSessionEvent extends WsEventBase {
  type: "runtime_session_event";
  nodeId: string;
  agentId: string;
  sessionId: string;
  event: Record<string, unknown>;
}

export interface WsMcpToolCalledEvent extends WsEventBase {
  type: "mcp_tool_called";
  nodeId: string;
  agentId: string;
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
}

/** Discriminated union of all WS events broadcast by the daemon. */
export type WsEvent =
  | WsNodeStatusEvent
  | WsAgentStatusEvent
  | WsAgentMessageEvent
  | WsReviewVerdictEvent
  | WsGraphModifiedEvent
  | WsCostUpdateEvent
  | WsChatResponseEvent
  | WsSpecArtifactReadyEvent
  | WsMemoryUpdatedEvent
  | WsRuntimeSessionStartedEvent
  | WsRuntimeSessionEvent
  | WsMcpToolCalledEvent;

// ============================================================================
// Lightweight project model used by the SPA (UI projection)
// ============================================================================

/** Aggregate UI status for project cards. */
export type UiProjectStatus =
  | "pending"
  | "init"
  | "spec"
  | "building"
  | "running"
  | "paused"
  | "done"
  | "failed";

/** Per-card progress counters. */
export interface ProjectNodeCount {
  spec: number;
  worker: number;
  done: number;
}

/** Per-card config snippet. */
export interface ProjectCardConfig {
  template: string;
  stack: string[];
  level: Level;
}

/** UI-side project record (rendered by ProjectsPage). */
export interface UiProject {
  id: string;
  name: string;
  projectPath: string;
  createdAt: string;
  lastActivityAt: string;
  status: UiProjectStatus;
  workflowStatus: WorkflowStatus;
  nodeCount: ProjectNodeCount;
  runningNode?: string;
  runningAgent?: AgentRole;
  config: ProjectCardConfig;
  createdBy: "user" | "cli";
}
