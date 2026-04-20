// ============================================================================
// Dashboard Mirror Types
//
// Pure TypeScript interfaces mirroring @loomflo/core types.
// No runtime dependencies — no zod, no imports from @loomflo/core.
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
  | "blocked";

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
  status: TaskVerificationStatus;
  /** Explanation of what was found during verification. */
  details: string;
}

/** Cumulative token usage for an agent. */
export interface TokenUsage {
  /** Number of input tokens consumed. */
  input: number;
  /** Number of output tokens produced. */
  output: number;
}

// ============================================================================
// Medium Types
// ============================================================================

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

/** Per-role model configuration mapping agent roles to LLM model identifiers. */
export interface ModelsConfig {
  /** LLM model for the Loom (Architect) agent. */
  loom: string;
  /** LLM model for the Loomi (Orchestrator) agent. */
  loomi: string;
  /** LLM model for the Looma (Worker) agent. */
  looma: string;
  /** LLM model for the Loomex (Reviewer) agent. */
  loomex: string;
}

/** Full Loomflo configuration with all fields resolved. */
export interface Config {
  /** Preset level controlling default agent topology and behavior. */
  level: Level;
  /** Default delay between node activations (e.g., "0", "30m", "1h", "1d"). */
  defaultDelay: string;
  /** Whether the Loomex reviewer agent is enabled. */
  reviewerEnabled: boolean;
  /** Maximum retry cycles allowed per node before marking as failed. */
  maxRetriesPerNode: number;
  /** Maximum retries allowed per individual task within a node. */
  maxRetriesPerTask: number;
  /** Maximum worker agents (Loomas) per orchestrator (Loomi). Null means unlimited. */
  maxLoomasPerLoomi: number | null;
  /** Strategy for modifying prompts on retry. */
  retryStrategy: RetryStrategy;
  /** Per-role LLM model assignments. */
  models: ModelsConfig;
  /** LLM provider identifier (e.g., "anthropic", "openai"). */
  provider: string;
  /** Maximum total cost in USD before pausing the workflow. Null means no limit. */
  budgetLimit: number | null;
  /** Whether to pause the workflow when the budget limit is reached. */
  pauseOnBudgetReached: boolean;
  /** Whether shell commands executed by agents are sandboxed to the project workspace. */
  sandboxCommands: boolean;
  /** Whether agents are allowed to make outbound HTTP requests. */
  allowNetwork: boolean;
  /** TCP port for the monitoring dashboard. */
  dashboardPort: number;
  /** Whether to automatically open the dashboard in a browser on daemon start. */
  dashboardAutoOpen: boolean;
  /** Wall-clock timeout per agent call in milliseconds (default: 10 minutes). */
  agentTimeout: number;
  /** Maximum tokens per agent LLM call. */
  agentTokenLimit: number;
  /** Maximum LLM API calls per minute per agent (rate limiting). */
  apiRateLimit: number;
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
// Cost Tracking
// ============================================================================

/** A single cost ledger entry for an LLM API call. */
export interface CostEntry {
  /** LLM model identifier that produced this cost. */
  model: string;
  /** Number of input tokens consumed. */
  inputTokens: number;
  /** Number of output tokens produced. */
  outputTokens: number;
  /** Cost in USD for this entry. */
  cost: number;
  /** Agent that incurred the cost. */
  agentId: string;
  /** Node context for the cost. */
  nodeId: string;
  /** ISO 8601 timestamp when the cost was recorded. */
  timestamp: string;
}

/** Aggregated cost summary across all entries. */
export interface CostSummary {
  /** Individual cost entries. */
  entries: CostEntry[];
  /** Total cost in USD across all entries. */
  totalCost: number;
  /** Total input tokens across all entries. */
  totalInputTokens: number;
  /** Total output tokens across all entries. */
  totalOutputTokens: number;
}

// ============================================================================
// Project Types
// ============================================================================

/** Summary of a project returned by the list endpoint. */
export interface ProjectSummary {
  /** Unique project identifier. */
  id: string;
  /** Human-readable project name. */
  name: string;
  /** Absolute filesystem path of the project workspace. */
  projectPath: string;
  /** Current project status. */
  status: "idle" | "running" | "blocked" | "failed" | "completed";
  /** ID of the currently executing node, or null. */
  currentNodeId: string | null;
  /** Accumulated cost in USD. */
  cost: number;
  /** ISO 8601 timestamp when the project started, or null. */
  startedAt: string | null;
}

/** Detailed project info including its workflow. */
export type ProjectDetail = ProjectSummary & {
  /** Associated workflow summary. */
  workflow: { id: string; status: string };
};

// ============================================================================
// Chat Types
// ============================================================================

/** Request body for the chat endpoint. */
export interface ChatBody {
  /** Ordered list of chat messages. */
  messages: Array<{ role: string; content: string }>;
}

/** Response from the chat endpoint. */
export interface ChatResponse {
  /** The assistant's reply message. */
  message: { role: string; content: string };
}

// ============================================================================
// Memory & Specs (simplified aliases)
// ============================================================================

/** Shared memory state. */
export interface Memory {
  /** Memory files. */
  files: Array<{ name: string; lastModifiedBy: string; lastModifiedAt: string }>;
}

/** Spec artifacts. */
export interface Specs {
  /** Available spec artifacts. */
  artifacts: Array<{ name: string; path: string; size: number }>;
}
