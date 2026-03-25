import { z } from 'zod';
import { ConfigSchema } from './config.js';

// ============================================================================
// Enums / Literals
// ============================================================================

/** Zod schema for workflow lifecycle states. */
export const WorkflowStatusSchema = z.enum([
  'init',
  'spec',
  'building',
  'running',
  'paused',
  'done',
  'failed',
]);

/** Workflow lifecycle state. */
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

/** Zod schema for node execution states. */
export const NodeStatusSchema = z.enum([
  'pending',
  'waiting',
  'running',
  'review',
  'done',
  'failed',
  'blocked',
]);

/** Node execution state. */
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

/** Zod schema for agent role identifiers. */
export const AgentRoleSchema = z.enum(['loom', 'loomi', 'looma', 'loomex']);

/** Agent role: loom (architect), loomi (orchestrator), looma (worker), loomex (reviewer). */
export type AgentRole = z.infer<typeof AgentRoleSchema>;

/** Zod schema for agent lifecycle states. */
export const AgentStatusSchema = z.enum([
  'created',
  'running',
  'completed',
  'failed',
]);

/** Agent lifecycle state. */
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** Zod schema for graph topology classifications. */
export const TopologyTypeSchema = z.enum([
  'linear',
  'divergent',
  'convergent',
  'tree',
  'mixed',
]);

/** Graph topology classification. */
export type TopologyType = z.infer<typeof TopologyTypeSchema>;

/** Zod schema for all event types emitted by the engine. */
export const EventTypeSchema = z.enum([
  'workflow_created',
  'workflow_started',
  'workflow_paused',
  'workflow_resumed',
  'workflow_completed',
  'spec_phase_started',
  'spec_phase_completed',
  'graph_built',
  'graph_modified',
  'node_started',
  'node_completed',
  'node_failed',
  'node_blocked',
  'agent_created',
  'agent_completed',
  'agent_failed',
  'reviewer_started',
  'reviewer_verdict',
  'retry_triggered',
  'escalation_triggered',
  'message_sent',
  'cost_tracked',
  'memory_updated',
]);

/** Event type identifier for the event log. */
export type EventType = z.infer<typeof EventTypeSchema>;

// ============================================================================
// Simple Types
// ============================================================================

/** Zod schema for a directed edge between two nodes. */
export const EdgeSchema = z.object({
  /** Source node ID. */
  from: z.string(),
  /** Target node ID. */
  to: z.string(),
});

/** A directed edge between two nodes in the workflow graph. */
export type Edge = z.infer<typeof EdgeSchema>;

/** Zod schema for a single task verification result within a review report. */
export const TaskVerificationSchema = z.object({
  /** Identifier of the verified task. */
  taskId: z.string(),
  /** Task-level verification result. */
  status: z.enum(['pass', 'fail', 'blocked']),
  /** Explanation of what was found during verification. */
  details: z.string(),
});

/** Per-task verification result from a Loomex review. */
export type TaskVerification = z.infer<typeof TaskVerificationSchema>;

/** Zod schema for a text content block in an LLM response. */
const TextBlockSchema = z.object({
  /** Block type discriminator. */
  type: z.literal('text'),
  /** The text content. */
  text: z.string(),
});

/** Zod schema for a tool-use content block in an LLM response. */
const ToolUseBlockSchema = z.object({
  /** Block type discriminator. */
  type: z.literal('tool_use'),
  /** Unique tool-use invocation ID. */
  id: z.string(),
  /** Tool name being invoked. */
  name: z.string(),
  /** Tool input arguments. */
  input: z.record(z.string(), z.unknown()),
});

/** Zod schema for a tool-result content block in an LLM response. */
const ToolResultBlockSchema = z.object({
  /** Block type discriminator. */
  type: z.literal('tool_result'),
  /** ID of the tool-use invocation this result responds to. */
  toolUseId: z.string(),
  /** Tool execution result as a string. */
  content: z.string(),
});

/** Zod schema for a content block in an LLM response (text, tool_use, or tool_result). */
export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
]);

/** A content block in an LLM response: text, tool invocation, or tool result. */
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

/** Zod schema for a JSON-serializable tool definition sent to the LLM. */
export const ToolDefinitionSchema = z.object({
  /** Tool identifier (e.g., "read_file"). */
  name: z.string(),
  /** Human-readable description included in the LLM prompt. */
  description: z.string(),
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: z.record(z.string(), z.unknown()),
});

/** JSON-serializable tool definition sent to the LLM for tool-use. */
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/** Zod schema for a shared memory file managed by the daemon. */
export const SharedMemoryFileSchema = z.object({
  /** File name (e.g., "DECISIONS.md"). */
  name: z.string(),
  /** Full path within .loomflo/shared-memory/. */
  path: z.string(),
  /** Current file content (Markdown). */
  content: z.string(),
  /** Agent ID that last wrote to this file. */
  lastModifiedBy: z.string(),
  /** ISO 8601 timestamp of last modification. */
  lastModifiedAt: z.string().datetime(),
});

/** A shared memory file managed by the daemon for cross-node state. */
export type SharedMemoryFile = z.infer<typeof SharedMemoryFileSchema>;

// ============================================================================
// Medium Types
// ============================================================================

/** Zod schema for agent token usage tracking. */
export const TokenUsageSchema = z.object({
  /** Number of input tokens consumed. */
  input: z.number().int().nonnegative(),
  /** Number of output tokens produced. */
  output: z.number().int().nonnegative(),
});

/** Cumulative token usage for an agent. */
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** Zod schema for agent metadata assigned to a node. */
export const AgentInfoSchema = z.object({
  /** Unique agent identifier (e.g., "looma-auth-1"). */
  id: z.string(),
  /** Agent role in the workflow. */
  role: AgentRoleSchema,
  /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
  model: z.string(),
  /** Current agent lifecycle state. */
  status: AgentStatusSchema,
  /** Glob patterns defining the agent's file write permissions. */
  writeScope: z.array(z.string()),
  /** Description of the agent's assigned task. */
  taskDescription: z.string(),
  /** Cumulative token usage for this agent's LLM calls. */
  tokenUsage: TokenUsageSchema,
  /** Cumulative cost in USD for this agent's LLM calls. */
  cost: z.number().nonnegative(),
});

/** Metadata about an agent assigned to a workflow node. */
export type AgentInfo = z.infer<typeof AgentInfoSchema>;

/** Zod schema for a structured review report from Loomex. */
export const ReviewReportSchema = z.object({
  /** Overall review verdict. */
  verdict: z.enum(['PASS', 'FAIL', 'BLOCKED']),
  /** Per-task verification results. */
  tasksVerified: z.array(TaskVerificationSchema),
  /** Detailed findings: what works, what's missing, what's blocked. */
  details: z.string(),
  /** Specific recommended actions for retry or escalation. */
  recommendation: z.string(),
  /** ISO 8601 timestamp when the review was produced. */
  createdAt: z.string().datetime(),
});

/** Structured review report produced by a Loomex reviewer agent. */
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

/** Zod schema for an inter-agent message routed by the MessageBus. */
export const MessageSchema = z.object({
  /** Unique message identifier. */
  id: z.string().uuid(),
  /** Sender agent ID. */
  from: z.string(),
  /** Recipient agent ID. */
  to: z.string(),
  /** Node context (messages are node-scoped). */
  nodeId: z.string(),
  /** Message body. */
  content: z.string(),
  /** ISO 8601 timestamp when the message was sent. */
  timestamp: z.string().datetime(),
});

/** An inter-agent message routed by the MessageBus within a node. */
export type Message = z.infer<typeof MessageSchema>;

/** Zod schema for an event log entry. */
export const EventSchema = z.object({
  /** ISO 8601 precise timestamp. */
  ts: z.string().datetime(),
  /** Event type identifier. */
  type: EventTypeSchema,
  /** Workflow this event belongs to. */
  workflowId: z.string(),
  /** Node this event relates to, or null for workflow-level events. */
  nodeId: z.string().nullable(),
  /** Agent this event relates to, or null for node/workflow-level events. */
  agentId: z.string().nullable(),
  /** Event-specific payload data. */
  details: z.record(z.string(), z.unknown()),
});

/** A single entry in the workflow event log (events.jsonl). */
export type Event = z.infer<typeof EventSchema>;

/** Zod schema for an LLM response from a provider. */
export const LLMResponseSchema = z.object({
  /** Response content blocks. */
  content: z.array(ContentBlockSchema),
  /** Reason the LLM stopped generating. */
  stopReason: z.enum(['end_turn', 'tool_use']),
  /** Token usage for this response. */
  usage: z.object({
    /** Input tokens consumed. */
    inputTokens: z.number().int().nonnegative(),
    /** Output tokens produced. */
    outputTokens: z.number().int().nonnegative(),
  }),
  /** Model identifier that produced this response. */
  model: z.string(),
});

/** Structured response from an LLM provider. */
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// ============================================================================
// Complex Types
// ============================================================================

/** Zod schema for a workflow node. */
export const NodeSchema = z.object({
  /** Unique node identifier (e.g., "node-1"). */
  id: z.string(),
  /** Human-readable node name (e.g., "Setup Authentication"). */
  title: z.string(),
  /** Current node execution state. */
  status: NodeStatusSchema,
  /** Markdown instructions for this node. */
  instructions: z.string(),
  /** Delay before activation (e.g., "0", "30m", "1h", "1d"). */
  delay: z.string(),
  /** ISO 8601 timestamp when the delay expires, or null. */
  resumeAt: z.string().datetime().nullable(),
  /** Agents assigned to this node. */
  agents: z.array(AgentInfoSchema),
  /** Agent ID to glob patterns mapping for write scope enforcement. */
  fileOwnership: z.record(z.string(), z.array(z.string())),
  /** Number of retry cycles attempted. */
  retryCount: z.number().int().nonnegative(),
  /** Maximum allowed retry cycles (from config). */
  maxRetries: z.number().int().nonnegative(),
  /** Loomex review report, or null if no review has run. */
  reviewReport: ReviewReportSchema.nullable(),
  /** Total accumulated cost in USD for this node (including retries). */
  cost: z.number().nonnegative(),
  /** ISO 8601 timestamp when the node started running, or null. */
  startedAt: z.string().datetime().nullable(),
  /** ISO 8601 timestamp when the node finished, or null. */
  completedAt: z.string().datetime().nullable(),
});

/** A workflow node representing one major step in the execution graph. */
export type Node = z.infer<typeof NodeSchema>;

/** Zod schema for the directed execution graph. Uses z.record for JSON serialization. */
export const GraphSchema = z.object({
  /** All nodes keyed by node ID. */
  nodes: z.record(z.string(), NodeSchema),
  /** Directed edges connecting nodes. */
  edges: z.array(EdgeSchema),
  /** Graph topology classification. */
  topology: TopologyTypeSchema,
});

/** The directed acyclic graph defining workflow execution topology. */
export type Graph = z.infer<typeof GraphSchema>;

// Re-export the full Config type from config.ts.
// ConfigSchema is imported above for use in WorkflowSchema and exported from config.ts via index.ts.
export type { Config } from './config.js';

/** Zod schema for the top-level workflow entity. */
export const WorkflowSchema = z.object({
  /** Unique workflow identifier. */
  id: z.string().uuid(),
  /** Current workflow lifecycle state. */
  status: WorkflowStatusSchema,
  /** Original natural language project description. */
  description: z.string(),
  /** Absolute path to the project workspace. */
  projectPath: z.string(),
  /** The directed execution graph. */
  graph: GraphSchema,
  /** Merged configuration (global + project + CLI). */
  config: ConfigSchema,
  /** ISO 8601 timestamp when the workflow was created. */
  createdAt: z.string().datetime(),
  /** ISO 8601 timestamp of the last state change. */
  updatedAt: z.string().datetime(),
  /** Accumulated cost in USD across all nodes. */
  totalCost: z.number().nonnegative(),
});

/** The top-level workflow entity representing a project being built. */
export type Workflow = z.infer<typeof WorkflowSchema>;
