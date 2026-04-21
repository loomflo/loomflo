import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { LoomAgent } from "../../agents/loom.js";
import type { ChatResult, ChatMessageCategory } from "../../agents/loom.js";
import type { ProjectRuntime } from "../../daemon-types.js";

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
// Per-runtime Chat State
// ============================================================================

/** Per-runtime chat state (LoomAgent + in-memory history). */
interface RuntimeChatState {
  loom: LoomAgent;
  history: ChatHistoryEntry[];
}

/**
 * Per-runtime chat state cache.
 *
 * Keyed by {@link ProjectRuntime} so each project gets its own LoomAgent and
 * isolated chat history. WeakMap ensures entries are garbage-collected along
 * with the runtime when a project is deregistered.
 *
 * NOTE: Chat history is currently stored only in-memory — persistence across
 * daemon restarts is tracked as technical debt.
 */
const runtimeStates: WeakMap<ProjectRuntime, RuntimeChatState> = new WeakMap();

/** Get or lazily create the chat state for a given project runtime. */
function getOrCreateRuntimeState(rt: ProjectRuntime): RuntimeChatState {
  const existing = runtimeStates.get(rt);
  if (existing !== undefined) return existing;

  const loom = new LoomAgent({
    provider: rt.provider,
    projectPath: rt.projectPath,
    eventLog: { workflowId: rt.workflow?.id ?? rt.id },
    sharedMemory: rt.sharedMemory,
    costTracker: rt.costTracker,
    defaultDelay: rt.config.defaultDelay,
  });

  const state: RuntimeChatState = { loom, history: [] };
  runtimeStates.set(rt, state);
  return state;
}

/**
 * Format a list of chat history entries into the plain-text transcript format
 * expected by {@link LoomAgent.handleChat}.
 */
function formatChatHistory(entries: ChatHistoryEntry[]): string {
  return entries.map((e) => `${e.role}: ${e.content}`).join("\n");
}

/** Resolved chat services for a single request. */
interface ResolvedChatServices {
  handleChat: ((message: string) => Promise<ChatResult>) | undefined;
  getChatHistory: () => ChatHistoryEntry[];
  addToHistory: (entry: ChatHistoryEntry) => void;
}

/**
 * Resolve chat services from either `request.runtime` (multi-project daemon
 * path) or the option closures (legacy/unit-test path).
 */
function resolveChatServices(
  request: FastifyRequest,
  options: ChatRoutesOptions,
): ResolvedChatServices {
  const rt = (request as FastifyRequest & { runtime?: ProjectRuntime }).runtime;

  if (rt) {
    const state = getOrCreateRuntimeState(rt);
    // Snapshot history at resolve time so the current user message (appended
    // just before handleChat is invoked) is not included in the "previous"
    // transcript sent to the LoomAgent.
    const priorHistory = state.history.slice();
    return {
      handleChat: (message: string): Promise<ChatResult> =>
        state.loom.handleChat(message, formatChatHistory(priorHistory)),
      getChatHistory: (): ChatHistoryEntry[] => state.history.slice(),
      addToHistory: (entry: ChatHistoryEntry): void => {
        state.history.push(entry);
      },
    };
  }

  return {
    handleChat: options.handleChat,
    getChatHistory: options.getChatHistory ?? ((): ChatHistoryEntry[] => []),
    addToHistory: options.addToHistory ?? ((): void => undefined),
  };
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers chat routes.
 *
 * - POST /chat — send a message to Loom and receive a response.
 * - GET /chat/history — retrieve the full chat history.
 *
 * When mounted under a per-project scope (`/projects/:id`), the plugin reads
 * the {@link ProjectRuntime} from `request.runtime` and creates a dedicated
 * {@link LoomAgent} plus in-memory history per project. When registered at
 * the root (legacy/unit tests), the option closures are used instead.
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
      const { handleChat, addToHistory } = resolveChatServices(request, options);

      if (!handleChat) {
        await reply.code(501).send({ error: "Chat not configured for this project" });
        return;
      }

      addToHistory({
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });

      const result: ChatResult = await handleChat(message);

      addToHistory({
        role: "assistant",
        content: result.response,
        timestamp: new Date().toISOString(),
      });

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
    fastify.get("/chat/history", async (request, reply): Promise<void> => {
      const { getChatHistory } = resolveChatServices(request, options);
      const response: ChatHistoryResponse = { messages: getChatHistory() };
      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };

  return plugin;
}
