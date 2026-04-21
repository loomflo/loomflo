import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LoomAgent } from "../../agents/loom.js";
import type { ChatResult, ChatMessageCategory } from "../../agents/loom.js";
import type { GraphModification } from "../../agents/escalation.js";
import type { ProjectRuntime } from "../../daemon-types.js";
import type { Node, Workflow } from "../../types.js";
import { WorkflowGraph } from "../../workflow/graph.js";

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
  /** Return the current workflow (used by the legacy / unit-test path). */
  getWorkflow?: () => Workflow | null;
  /** Persist an updated workflow (used by the legacy / unit-test path). */
  setWorkflow?: (workflow: Workflow) => void;
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
  getWorkflow: () => Workflow | null;
  setWorkflow: (workflow: Workflow) => void;
  runtime: ProjectRuntime | undefined;
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
      getWorkflow: (): Workflow | null => rt.workflow,
      setWorkflow: (wf: Workflow): void => {
        rt.workflow = wf;
      },
      runtime: rt,
    };
  }

  return {
    handleChat: options.handleChat,
    getChatHistory: options.getChatHistory ?? ((): ChatHistoryEntry[] => []),
    addToHistory: options.addToHistory ?? ((): void => undefined),
    getWorkflow: options.getWorkflow ?? ((): Workflow | null => null),
    setWorkflow: options.setWorkflow ?? ((): void => undefined),
    runtime: undefined,
  };
}

// ============================================================================
// Graph modification applier
// ============================================================================

/**
 * Build a fully-populated {@link Node} from the fragment supplied by
 * {@link GraphModification.newNode}. The LLM only provides a title and
 * instructions; the daemon owns the remaining runtime fields.
 */
function buildNodeFromFragment(
  fragment: NonNullable<GraphModification["newNode"]>,
  defaultDelay: string,
): Node {
  return {
    id: `node-${randomUUID().slice(0, 8)}`,
    title: fragment.title,
    status: "pending",
    instructions: fragment.instructions,
    delay: defaultDelay,
    resumeAt: null,
    agents: [],
    fileOwnership: {},
    retryCount: 0,
    maxRetries: 3,
    reviewReport: null,
    cost: 0,
    startedAt: null,
    completedAt: null,
    providerRetryState: null,
  };
}

/**
 * Apply a graph modification to a workflow in-place and return the updated
 * workflow. Returns `null` when the modification cannot be applied (e.g.
 * target node missing, cycle introduced, or add_node on a null workflow
 * without enough context to scaffold one).
 *
 * Semantics:
 *   - add_node on a null workflow creates a new single-node workflow in
 *     "building" state so `loomflo status` stops returning null. The
 *     description is taken from the modification reason or a default.
 *   - add_node on an existing workflow inserts the node and wires edges
 *     per insertAfter / insertBefore when supplied.
 *   - modify_node updates the target's instructions.
 *   - remove_node removes the target and its incident edges.
 *   - skip_node marks the target as "done" (leaves it in the graph).
 *   - no_action is a no-op; callers should not invoke the applier.
 */
export function applyChatModification(
  workflow: Workflow | null,
  modification: GraphModification,
  context: { projectPath: string; defaultDelay: string; description: string },
): Workflow | null {
  if (modification.action === "no_action") return workflow;

  // Creating a workflow from scratch via chat. Only "add_node" makes sense
  // — we have no graph to point at for the other actions.
  if (workflow === null) {
    if (modification.action !== "add_node" || !modification.newNode) return null;
    const node = buildNodeFromFragment(modification.newNode, context.defaultDelay);
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      status: "building",
      description: context.description || modification.reason || "chat-seeded workflow",
      projectPath: context.projectPath,
      graph: {
        nodes: { [node.id]: node },
        edges: [],
        topology: "linear",
      },
      // The daemon fills rt.config; the chat route does not have access to
      // merged config without round-tripping loadConfig. We reuse the
      // caller-supplied config snapshot via `workflow.config` only when an
      // existing workflow is present — for the scaffold path we copy the
      // default delay into a minimal Config-shaped object below. Keeping
      // this untyped-but-checked to avoid pulling the full ConfigSchema
      // here.
      config: {} as Workflow["config"],
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
    };
  }

  const graph = new WorkflowGraph(workflow.graph.nodes, workflow.graph.edges);

  switch (modification.action) {
    case "add_node": {
      if (!modification.newNode) return null;
      const node = buildNodeFromFragment(modification.newNode, context.defaultDelay);
      graph.addNode(node);
      if (modification.newNode.insertAfter) {
        try {
          graph.addEdge({ from: modification.newNode.insertAfter, to: node.id });
        } catch {
          /* ignore edge wiring failures — the node is still added */
        }
      }
      if (modification.newNode.insertBefore) {
        try {
          graph.addEdge({ from: node.id, to: modification.newNode.insertBefore });
        } catch {
          /* ignore */
        }
      }
      break;
    }
    case "modify_node": {
      if (!modification.nodeId) return null;
      if (!graph.getNode(modification.nodeId)) return null;
      if (modification.modifiedInstructions !== undefined) {
        graph.updateNode(modification.nodeId, {
          instructions: modification.modifiedInstructions,
        });
      }
      break;
    }
    case "remove_node": {
      if (!modification.nodeId) return null;
      if (!graph.getNode(modification.nodeId)) return null;
      graph.removeNode(modification.nodeId);
      break;
    }
    case "skip_node": {
      if (!modification.nodeId) return null;
      if (!graph.getNode(modification.nodeId)) return null;
      graph.updateNode(modification.nodeId, { status: "done" });
      break;
    }
    default:
      return null;
  }

  return {
    ...workflow,
    graph: graph.toJSON(),
    updatedAt: new Date().toISOString(),
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
      const services = resolveChatServices(request, options);
      const { handleChat, addToHistory, getWorkflow, setWorkflow, runtime } = services;

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

      // Persist graph_modified actions so `loomflo status` reflects chat-driven
      // changes. Scaffolds a single-node workflow when `add_node` is returned
      // against a project with no active workflow, otherwise mutates the
      // existing graph in-place.
      if (result.modification !== null && result.modification.action !== "no_action") {
        try {
          const current = getWorkflow();
          const updated = applyChatModification(current, result.modification, {
            projectPath: runtime?.projectPath ?? current?.projectPath ?? "",
            defaultDelay: runtime?.config.defaultDelay ?? current?.config.defaultDelay ?? "0",
            description: current?.description ?? message,
          });
          if (updated !== null && updated !== current) {
            // Merge runtime config into the scaffolded workflow when we just
            // created one from scratch (current === null path).
            if (current === null && runtime) {
              updated.config = runtime.config;
            }
            setWorkflow(updated);
          }
        } catch {
          // Non-fatal: chat response is still returned even if the graph
          // mutation fails. The error bubbles up via the graph library's
          // exception and would otherwise mask the assistant reply.
        }
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
    fastify.get("/chat/history", async (request, reply): Promise<void> => {
      const { getChatHistory } = resolveChatServices(request, options);
      const response: ChatHistoryResponse = { messages: getChatHistory() };
      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };

  return plugin;
}
