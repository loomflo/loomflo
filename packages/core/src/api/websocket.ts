import type { NodeStatus, AgentStatus, ReviewReport } from '../types.js';

// ============================================================================
// Types
// ============================================================================

/** WebSocket event type identifiers broadcast to connected clients. */
export type WsEventType =
  | 'node_status'
  | 'agent_status'
  | 'agent_message'
  | 'review_verdict'
  | 'graph_modified'
  | 'cost_update'
  | 'chat_response'
  | 'spec_artifact_ready'
  | 'memory_updated';

/** Base shape shared by all WebSocket events. */
export interface WsEventBase {
  /** Event kind discriminator. */
  type: WsEventType;
  /** ISO 8601 timestamp when the event was emitted. */
  timestamp: string;
}

/** Payload broadcast when a node changes execution state. */
export interface WsNodeStatusEvent extends WsEventBase {
  type: 'node_status';
  /** Node whose status changed. */
  nodeId: string;
  /** New node status. */
  status: NodeStatus;
  /** Optional additional context about the status change. */
  details?: Record<string, unknown>;
}

/** Payload broadcast when an agent changes lifecycle state. */
export interface WsAgentStatusEvent extends WsEventBase {
  type: 'agent_status';
  /** Node the agent belongs to. */
  nodeId: string;
  /** Agent whose status changed. */
  agentId: string;
  /** New agent status. */
  status: AgentStatus;
  /** Optional additional context about the status change. */
  details?: Record<string, unknown>;
}

/** Payload broadcast when an agent sends or receives a message. */
export interface WsAgentMessageEvent extends WsEventBase {
  type: 'agent_message';
  /** Node context for the message. */
  nodeId: string;
  /** Agent that sent or received the message. */
  agentId: string;
  /** Message content. */
  message: string;
}

/** Payload broadcast when a Loomex reviewer produces a verdict. */
export interface WsReviewVerdictEvent extends WsEventBase {
  type: 'review_verdict';
  /** Node that was reviewed. */
  nodeId: string;
  /** Overall review verdict. */
  verdict: ReviewReport['verdict'];
  /** Full structured review report. */
  report: ReviewReport;
}

/** Graph modification action types. */
export type GraphAction = 'node_added' | 'node_removed' | 'node_modified' | 'edge_added' | 'edge_removed';

/** Payload broadcast when the workflow graph is modified. */
export interface WsGraphModifiedEvent extends WsEventBase {
  type: 'graph_modified';
  /** What kind of modification occurred. */
  action: GraphAction;
  /** Node affected by the modification, if applicable. */
  nodeId?: string;
  /** Optional additional context about the modification. */
  details?: Record<string, unknown>;
}

/** Payload broadcast after every LLM call with updated cost information. */
export interface WsCostUpdateEvent extends WsEventBase {
  type: 'cost_update';
  /** Node where the LLM call occurred. */
  nodeId: string;
  /** Cost of the individual LLM call in USD. */
  callCost: number;
  /** Total accumulated cost for this node in USD. */
  nodeCost: number;
  /** Total accumulated cost across the entire workflow in USD. */
  totalCost: number;
  /** Remaining budget in USD, or undefined if no budget limit is set. */
  budgetRemaining?: number;
}

/** Describes a graph modification action included in a chat response. */
export interface WsChatAction {
  /** The type of graph modification (e.g. 'add_node', 'modify_node'). */
  type: string;
  /** Additional details about the modification. */
  details: Record<string, unknown>;
}

/** Payload broadcast when Loom sends a chat response to the dashboard. */
export interface WsChatResponseEvent extends WsEventBase {
  type: 'chat_response';
  /** The text response from Loom. */
  response: string;
  /** Category the message was classified as (question, instruction, or graph_change). */
  category: string;
  /** Graph modification action if the message triggered one, or null. */
  action: WsChatAction | null;
}

/** Payload broadcast when a spec artifact is generated during Phase 1. */
export interface WsSpecArtifactReadyEvent extends WsEventBase {
  type: 'spec_artifact_ready';
  /** File name of the generated artifact (e.g. "spec.md"). */
  name: string;
  /** Relative path to the artifact (e.g. ".loomflo/specs/spec.md"). */
  path: string;
}

/** Payload broadcast when a shared memory file is updated. */
export interface WsMemoryUpdatedEvent extends WsEventBase {
  type: 'memory_updated';
  /** Name of the memory file that was updated. */
  file: string;
  /** Description of what was updated. */
  summary: string;
  /** ID of the agent that triggered the update, if applicable. */
  agentId?: string;
}

/** Union of all WebSocket event payloads. */
export type WsEvent =
  | WsNodeStatusEvent
  | WsAgentStatusEvent
  | WsAgentMessageEvent
  | WsReviewVerdictEvent
  | WsGraphModifiedEvent
  | WsCostUpdateEvent
  | WsChatResponseEvent
  | WsSpecArtifactReadyEvent
  | WsMemoryUpdatedEvent;

/** Broadcast function signature matching the one returned by {@link createServer}. */
export type BroadcastFn = (event: Record<string, unknown>) => void;

// ============================================================================
// WebSocketBroadcaster
// ============================================================================

/**
 * Typed wrapper around the raw WebSocket broadcast function.
 *
 * Provides a clean, type-safe API for the engine to emit structured events
 * to all connected dashboard clients. Each method constructs a well-typed
 * event payload with an ISO 8601 timestamp and delegates to the underlying
 * broadcast function from `server.ts`.
 *
 * This class does NOT manage WebSocket connections — that responsibility
 * belongs to the server module.
 */
export class WebSocketBroadcaster {
  /** The underlying broadcast function from the server. */
  private readonly broadcast: BroadcastFn;

  /**
   * Create a new WebSocketBroadcaster.
   *
   * @param broadcast - The broadcast function returned by {@link createServer}.
   */
  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast;
  }

  /** Send a typed event through the raw broadcast function. */
  private emit(event: WsEvent): void {
    this.broadcast(event as unknown as Record<string, unknown>);
  }

  /**
   * Broadcast a node status change to all connected clients.
   *
   * @param nodeId - ID of the node whose status changed.
   * @param status - The new node status.
   * @param details - Optional additional context about the change.
   */
  emitNodeStatus(nodeId: string, status: NodeStatus, details?: Record<string, unknown>): void {
    const event: WsNodeStatusEvent = {
      type: 'node_status',
      timestamp: new Date().toISOString(),
      nodeId,
      status,
      ...(details !== undefined && { details }),
    };
    this.emit(event);
  }

  /**
   * Broadcast an agent status change to all connected clients.
   *
   * @param nodeId - ID of the node the agent belongs to.
   * @param agentId - ID of the agent whose status changed.
   * @param status - The new agent status.
   * @param details - Optional additional context about the change.
   */
  emitAgentStatus(
    nodeId: string,
    agentId: string,
    status: AgentStatus,
    details?: Record<string, unknown>,
  ): void {
    const event: WsAgentStatusEvent = {
      type: 'agent_status',
      timestamp: new Date().toISOString(),
      nodeId,
      agentId,
      status,
      ...(details !== undefined && { details }),
    };
    this.emit(event);
  }

  /**
   * Broadcast an agent message to all connected clients.
   *
   * @param nodeId - ID of the node where the message was sent.
   * @param agentId - ID of the agent that sent or received the message.
   * @param message - The message content.
   */
  emitAgentMessage(nodeId: string, agentId: string, message: string): void {
    const event: WsAgentMessageEvent = {
      type: 'agent_message',
      timestamp: new Date().toISOString(),
      nodeId,
      agentId,
      message,
    };
    this.emit(event);
  }

  /**
   * Broadcast a Loomex review verdict to all connected clients.
   *
   * @param nodeId - ID of the node that was reviewed.
   * @param verdict - The overall review verdict (PASS, FAIL, or BLOCKED).
   * @param report - The full structured review report.
   */
  emitReviewVerdict(nodeId: string, verdict: ReviewReport['verdict'], report: ReviewReport): void {
    const event: WsReviewVerdictEvent = {
      type: 'review_verdict',
      timestamp: new Date().toISOString(),
      nodeId,
      verdict,
      report,
    };
    this.emit(event);
  }

  /**
   * Broadcast a graph modification to all connected clients.
   *
   * @param action - The kind of modification (node_added, node_removed, etc.).
   * @param nodeId - ID of the affected node, if applicable.
   * @param details - Optional additional context about the modification.
   */
  emitGraphModified(action: GraphAction, nodeId?: string, details?: Record<string, unknown>): void {
    const event: WsGraphModifiedEvent = {
      type: 'graph_modified',
      timestamp: new Date().toISOString(),
      action,
      ...(nodeId !== undefined && { nodeId }),
      ...(details !== undefined && { details }),
    };
    this.emit(event);
  }

  /**
   * Broadcast a cost update after an LLM call to all connected clients.
   *
   * @param nodeId - ID of the node where the LLM call occurred.
   * @param callCost - Cost of the individual LLM call in USD.
   * @param nodeCost - Total accumulated cost for this node in USD.
   * @param totalCost - Total accumulated cost across the workflow in USD.
   * @param budgetRemaining - Remaining budget in USD, or undefined if no limit.
   */
  emitCostUpdate(
    nodeId: string,
    callCost: number,
    nodeCost: number,
    totalCost: number,
    budgetRemaining?: number,
  ): void {
    const event: WsCostUpdateEvent = {
      type: 'cost_update',
      timestamp: new Date().toISOString(),
      nodeId,
      callCost,
      nodeCost,
      totalCost,
      ...(budgetRemaining !== undefined && { budgetRemaining }),
    };
    this.emit(event);
  }

  /**
   * Broadcast a Loom chat response to all connected clients.
   *
   * @param response - The text response from Loom.
   * @param category - The classified category (question, instruction, or graph_change).
   * @param action - Graph modification action if the message triggered one, or null.
   */
  emitChatResponse(response: string, category: string, action: WsChatAction | null): void {
    const event: WsChatResponseEvent = {
      type: 'chat_response',
      timestamp: new Date().toISOString(),
      response,
      category,
      action,
    };
    this.emit(event);
  }

  /**
   * Broadcast that a spec artifact has been generated during Phase 1.
   *
   * @param name - File name of the generated artifact (e.g. "spec.md").
   * @param path - Relative path to the artifact (e.g. ".loomflo/specs/spec.md").
   */
  emitSpecArtifactReady(name: string, path: string): void {
    const event: WsSpecArtifactReadyEvent = {
      type: 'spec_artifact_ready',
      timestamp: new Date().toISOString(),
      name,
      path,
    };
    this.emit(event);
  }

  /**
   * Broadcast that a shared memory file has been updated.
   *
   * @param file - Name of the memory file that was updated.
   * @param summary - Description of what was updated.
   * @param agentId - ID of the agent that triggered the update, if applicable.
   */
  emitMemoryUpdated(file: string, summary: string, agentId?: string): void {
    const event: WsMemoryUpdatedEvent = {
      type: 'memory_updated',
      timestamp: new Date().toISOString(),
      file,
      summary,
      ...(agentId !== undefined && { agentId }),
    };
    this.emit(event);
  }
}
