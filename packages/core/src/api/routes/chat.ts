import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ChatResult, ChatMessageCategory } from "../../agents/loom.js";

// ============================================================================
// Types
// ============================================================================

/** A single entry in the chat history. */
export interface ChatHistoryEntry {
  /** Who sent the message. */
  role: "user" | "assistant";
  /** The message content. */
  content: string;
  /** ISO-8601 timestamp of the message. */
  timestamp: string;
}

/** Options accepted by the {@link chatRoutes} factory. */
export interface ChatRoutesOptions {
  /** Delegate a user message to the Loom agent. */
  handleChat?: (message: string) => Promise<ChatResult>;
  /** Return the current chat history. */
  getChatHistory?: () => ChatHistoryEntry[];
  /** Append an entry to the chat history. */
  addToHistory?: (entry: ChatHistoryEntry) => void;
}

/** Shape of the POST /chat JSON response. */
export interface ChatResponse {
  /** The assistant's response text. */
  response: string;
  /** Graph action taken, or null if none. */
  action: { type: string; details: Record<string, unknown> } | null;
  /** The classified message category. */
  category: ChatMessageCategory;
}

/** Shape of the GET /chat/history JSON response. */
export interface ChatHistoryResponse {
  /** All chat messages in chronological order. */
  messages: ChatHistoryEntry[];
}

// ============================================================================
// Request Schemas
// ============================================================================

/** Zod schema for POST /chat request body. */
const ChatMessageSchema = z.object({
  message: z.string().min(1),
});

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers chat routes.
 *
 * - POST /chat — send a message to Loom and receive a response.
 * - GET /chat/history — retrieve the full chat history.
 *
 * @param options - Callbacks that supply runtime data for the routes.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function chatRoutes(options: ChatRoutesOptions): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = (fastify): Promise<void> => {
    /**
     * POST /chat
     *
     * Validates the request body, delegates to the Loom agent, records both
     * user and assistant messages in history, and returns the response with
     * an optional action and category.
     */
    fastify.post("/chat", async (request, reply): Promise<void> => {
      const parseResult = ChatMessageSchema.safeParse(request.body);

      if (!parseResult.success) {
        await reply.code(400).send({
          error: "Invalid request body",
          details: parseResult.error.issues,
        });
        return;
      }

      const { message } = parseResult.data;

      const handleChat = options.handleChat;
      const addToHistory = options.addToHistory;

      if (!handleChat) {
        await reply.code(501).send({ error: "Chat not configured for this project" });
        return;
      }

      if (addToHistory) {
        addToHistory({
          role: "user",
          content: message,
          timestamp: new Date().toISOString(),
        });
      }

      const result: ChatResult = await handleChat(message);

      if (addToHistory) {
        addToHistory({
          role: "assistant",
          content: result.response,
          timestamp: new Date().toISOString(),
        });
      }

      const action: ChatResponse["action"] =
        result.modification !== null && result.modification.action !== "no_action"
          ? {
              type: "graph_modified",
              details: result.modification as unknown as Record<string, unknown>,
            }
          : null;

      const response: ChatResponse = {
        response: result.response,
        action,
        category: result.category,
      };

      await reply.code(200).send(response);
    });

    /**
     * GET /chat/history
     *
     * Returns the full chat history in chronological order.
     */
    fastify.get("/chat/history", async (_request, reply): Promise<void> => {
      const getChatHistory = options.getChatHistory;
      const messages = getChatHistory ? getChatHistory() : [];
      const response: ChatHistoryResponse = { messages };
      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };

  return plugin;
}
