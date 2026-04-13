import { randomUUID } from "node:crypto";
import type { Message } from "../types.js";
import type { MessageBusLike } from "../tools/send-message.js";

// ============================================================================
// MessageBus
// ============================================================================

/**
 * In-process message bus for agent-to-agent communication within a node.
 *
 * Each agent must be registered to a node before it can send or receive
 * messages. Messages are strictly node-scoped — agents in different nodes
 * cannot communicate through the bus (use shared memory for cross-node state).
 *
 * Implements {@link MessageBusLike} so it can be injected into the
 * `send_message` tool.
 */
export class MessageBus implements MessageBusLike {
  /**
   * Per-node, per-agent incoming message queues.
   *
   * Structure: `Map<nodeId, Map<agentId, Message[]>>`
   */
  private readonly queues = new Map<string, Map<string, Message[]>>();

  /** Append-only log of every message sent through the bus. */
  private readonly log: Message[] = [];

  // ==========================================================================
  // Registration
  // ==========================================================================

  /**
   * Register an agent to receive messages within a node.
   *
   * Creates an empty incoming queue for the agent. If the agent is already
   * registered to the same node, this is a no-op.
   *
   * @param agentId - Unique agent identifier.
   * @param nodeId - Node the agent belongs to.
   */
  registerAgent(agentId: string, nodeId: string): void {
    let nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) {
      nodeQueues = new Map<string, Message[]>();
      this.queues.set(nodeId, nodeQueues);
    }
    if (!nodeQueues.has(agentId)) {
      nodeQueues.set(agentId, []);
    }
  }

  /**
   * Unregister an agent from a node, removing its message queue.
   *
   * Any undelivered messages in the queue are discarded. If the node has no
   * remaining agents, the node entry is cleaned up.
   *
   * @param agentId - Unique agent identifier.
   * @param nodeId - Node the agent belongs to.
   */
  unregisterAgent(agentId: string, nodeId: string): void {
    const nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) return;
    nodeQueues.delete(agentId);
    if (nodeQueues.size === 0) {
      this.queues.delete(nodeId);
    }
  }

  // ==========================================================================
  // Messaging
  // ==========================================================================

  /**
   * Send a message from one agent to another within the same node.
   *
   * The message is validated, logged, and placed in the recipient's queue.
   * Rejects with an error if the sender or recipient is not registered to the
   * specified node.
   *
   * @param from - ID of the sending agent.
   * @param to - ID of the target agent.
   * @param nodeId - ID of the node both agents belong to.
   * @param content - The message text.
   * @throws Error if sender or recipient is not registered to the node.
   */
  send(from: string, to: string, nodeId: string, content: string): Promise<void> {
    const nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) {
      return Promise.reject(
        new Error(`Cannot send message: no agents registered for node "${nodeId}"`),
      );
    }
    if (!nodeQueues.has(from)) {
      return Promise.reject(
        new Error(`Cannot send message: sender "${from}" is not registered to node "${nodeId}"`),
      );
    }
    const recipientQueue = nodeQueues.get(to);
    if (!recipientQueue) {
      return Promise.reject(
        new Error(`Cannot send message: recipient "${to}" is not registered to node "${nodeId}"`),
      );
    }

    const message: Message = {
      id: randomUUID(),
      from,
      to,
      nodeId,
      content,
      timestamp: new Date().toISOString(),
    };

    this.log.push(message);
    recipientQueue.push(message);
    return Promise.resolve();
  }

  /**
   * Broadcast a message to all agents within the same node, except the sender.
   *
   * Creates one message per recipient. Each recipient gets an independent copy
   * with its own ID and timestamp.
   *
   * @param from - ID of the sending agent.
   * @param nodeId - ID of the node to broadcast within.
   * @param content - The message text.
   * @throws Error if the sender is not registered to the node.
   */
  broadcast(from: string, nodeId: string, content: string): Promise<void> {
    const nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) {
      return Promise.reject(
        new Error(`Cannot broadcast: no agents registered for node "${nodeId}"`),
      );
    }
    if (!nodeQueues.has(from)) {
      return Promise.reject(
        new Error(`Cannot broadcast: sender "${from}" is not registered to node "${nodeId}"`),
      );
    }

    for (const [agentId, queue] of nodeQueues) {
      if (agentId === from) continue;

      const message: Message = {
        id: randomUUID(),
        from,
        to: agentId,
        nodeId,
        content,
        timestamp: new Date().toISOString(),
      };

      this.log.push(message);
      queue.push(message);
    }

    return Promise.resolve();
  }

  /**
   * Retrieve and drain all pending messages for an agent within a node.
   *
   * Returns all queued messages and empties the agent's queue. Subsequent
   * calls return an empty array until new messages arrive.
   *
   * @param agentId - ID of the agent whose messages to collect.
   * @param nodeId - ID of the node the agent belongs to.
   * @returns Array of pending messages (may be empty). Empty array if the
   *          agent or node is not registered.
   */
  collect(agentId: string, nodeId: string): Message[] {
    const nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) return [];

    const queue = nodeQueues.get(agentId);
    if (!queue) return [];

    const messages = [...queue];
    queue.length = 0;
    return messages;
  }

  // ==========================================================================
  // Inspection
  // ==========================================================================

  /**
   * Get the message log for inspection or dashboard display.
   *
   * When `nodeId` is provided, returns only messages for that node.
   * Otherwise returns all logged messages across all nodes.
   *
   * @param nodeId - Optional node ID to filter by.
   * @returns Read-only array of logged messages.
   */
  getMessageLog(nodeId?: string): readonly Message[] {
    if (nodeId === undefined) {
      return this.log;
    }
    return this.log.filter((m) => m.nodeId === nodeId);
  }
}
