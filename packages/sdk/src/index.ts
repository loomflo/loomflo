/**
 * Loomflo SDK — programmatic client for the Loomflo daemon API.
 *
 * Provides the {@link LoomfloClient} class for interacting with a running
 * Loomflo daemon via REST and WebSocket, plus all public type definitions.
 *
 * @example
 * ```ts
 * import { LoomfloClient } from 'loomflo-sdk';
 *
 * const client = new LoomfloClient({ token: 'my-token' });
 * const health = await client.health();
 * console.log(health.status); // "ok"
 *
 * await client.connect();
 * client.onEvent('node_status', (evt) => console.log(evt));
 * ```
 *
 * @packageDocumentation
 */

// Re-export the client class and its error type.
export { LoomfloClient, LoomfloApiError } from "./client.js";

// Re-export all public types.
export type {
  // Enums / literal unions
  WorkflowStatus,
  NodeStatus,
  AgentRole,
  AgentStatus,
  TopologyType,
  EventType,
  ReviewVerdict,
  StopReason,

  // Simple types
  Edge,
  TaskVerification,
  TokenUsage,
  ToolDefinition,
  SharedMemoryFile,

  // Medium types
  AgentInfo,
  ReviewReport,
  Message,
  Event,

  // Complex types
  Node,
  Graph,
  Workflow,

  // Configuration
  ModelConfig,
  RetryConfig,
  Config,

  // API response types
  HealthWorkflowSummary,
  HealthResponse,
  WorkflowResponse,
  InitResponse,
  ChatAction,
  ChatResponse,
  ChatMessage,
  ChatHistoryResponse,
  NodeSummary,
  AgentDetail,
  NodeDetailResponse,
  NodeCost,
  CostsResponse,
  WorkflowEvent,
  EventsResponse,
  SpecArtifact,
  SpecsResponse,
  MemoryFile,
  MemoryResponse,

  // WebSocket event types
  WebSocketEvent,
  ConnectedEvent,
  NodeStatusEvent,
  AgentStatusEvent,
  AgentMessageEvent,
  ReviewVerdictEvent,
  GraphModifiedEvent,
  CostUpdateEvent,
  ChatResponseEvent,
  SpecArtifactReadyEvent,

  // Client options
  LoomfloClientOptions,
  EventCallback,
} from "./types.js";
