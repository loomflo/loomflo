import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Tool, ToolContext } from './base.js';

// ============================================================================
// MessageBusLike
// ============================================================================

/**
 * Minimal interface for the message bus dependency.
 *
 * Defines only the subset of MessageBus needed by the send_message tool,
 * avoiding a hard dependency on the full MessageBus implementation (T039).
 * Any object satisfying this interface can be injected at runtime.
 */
export interface MessageBusLike {
  /**
   * Send a message from one agent to another within a node.
   *
   * @param from - ID of the sending agent.
   * @param to - ID of the target agent.
   * @param nodeId - ID of the node both agents belong to.
   * @param content - The message text.
   * @returns Resolves when the message has been accepted by the bus.
   */
  send(from: string, to: string, nodeId: string, content: string): Promise<void>;
}

// ============================================================================
// Input Schema
// ============================================================================

/** Zod schema for send_message tool input. */
const SendMessageInputSchema = z.object({
  /** Target agent ID within the same node. */
  to: z.string().describe('Target agent ID within the same node'),
  /** Message text to send. */
  content: z.string().describe('Message text to send to the target agent'),
});

// ============================================================================
// createSendMessageTool
// ============================================================================

/**
 * Create a send_message tool wired to the given message bus.
 *
 * Uses a factory pattern so the tool can access a {@link MessageBusLike}
 * instance without requiring it on {@link ToolContext}. The tool uses
 * `context.agentId` as the sender and `context.nodeId` as the message scope.
 *
 * Messages are only routable within the same node — cross-node communication
 * goes through shared memory.
 *
 * @param messageBus - The message bus instance to send messages through.
 * @returns A {@link Tool} that sends messages via the provided bus.
 */
export function createSendMessageTool(messageBus: MessageBusLike): Tool {
  return {
    name: 'send_message',
    description:
      'Send a message to another agent within the same node. ' +
      'Provide the target agent ID and the message content. ' +
      'Messages are only routable within the same node — use shared memory ' +
      'for cross-node communication. Returns a confirmation with message details.',
    inputSchema: SendMessageInputSchema,

    async execute(input: unknown, context: ToolContext): Promise<string> {
      try {
        const { to, content } = SendMessageInputSchema.parse(input);

        const messageId = randomUUID();

        try {
          await messageBus.send(context.agentId, to, context.nodeId, content);
        } catch {
          return (
            `Error: failed to send message to agent "${to}" — ` +
            'the message bus rejected the delivery'
          );
        }

        return (
          `Message sent — id: ${messageId}, ` +
          `from: ${context.agentId}, to: ${to}, ` +
          `node: ${context.nodeId}`
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    },
  };
}
