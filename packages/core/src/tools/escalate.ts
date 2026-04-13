import { z } from "zod";
import type { Tool, ToolContext } from "./base.js";

// ============================================================================
// EscalationRequest
// ============================================================================

/**
 * Structured payload describing an escalation from a Loomi to Loom.
 *
 * Sent by an orchestrator agent (Loomi) when a node is BLOCKED or has
 * exhausted all retries, requesting the architect (Loom) to modify the
 * workflow graph.
 */
export interface EscalationRequest {
  /** Why the escalation is needed. */
  reason: string;
  /** ID of the node that is affected. */
  nodeId: string;
  /** ID of the agent requesting the escalation. */
  agentId: string;
  /** Optional suggestion for how Loom might resolve the issue. */
  suggestedAction?: "add_node" | "modify_node" | "remove_node" | "skip_node";
  /** Additional context about the failure. */
  details?: string;
}

// ============================================================================
// EscalationHandlerLike
// ============================================================================

/**
 * Minimal interface for the escalation handler dependency.
 *
 * Defines only the subset of behaviour needed by the escalate tool,
 * avoiding a hard dependency on a concrete Loom implementation.
 * Any object satisfying this interface can be injected at runtime.
 */
export interface EscalationHandlerLike {
  /**
   * Submit an escalation request to the architect (Loom).
   *
   * @param request - Structured escalation payload.
   * @returns Resolves when the escalation has been accepted.
   */
  escalate(request: EscalationRequest): Promise<void>;
}

// ============================================================================
// Input Schema
// ============================================================================

/** Zod schema for escalate tool input. */
const EscalateInputSchema = z.object({
  /** Reason why the escalation is needed. */
  reason: z.string().describe("Why the escalation is needed"),
  /** Optional suggestion for how Loom might resolve the issue. */
  suggestedAction: z
    .enum(["add_node", "modify_node", "remove_node", "skip_node"])
    .optional()
    .describe(
      "Optional suggestion for how the architect should handle it: " +
        '"add_node", "modify_node", "remove_node", or "skip_node"',
    ),
  /** Additional context about the failure. */
  details: z.string().optional().describe("Additional context about the failure or blockage"),
});

// ============================================================================
// createEscalateTool
// ============================================================================

/**
 * Create an escalate tool wired to the given escalation handler.
 *
 * Uses a factory pattern so the tool can access an {@link EscalationHandlerLike}
 * instance without requiring it on {@link ToolContext}. The tool uses
 * `context.agentId` and `context.nodeId` to identify the escalating agent.
 *
 * Only Loomi (orchestrator) agents use this tool. When a node is BLOCKED or
 * has exhausted all retries, the Loomi calls escalate to request graph
 * modifications from Loom (architect).
 *
 * @param handler - The escalation handler that receives requests.
 * @returns A {@link Tool} that submits escalations via the provided handler.
 */
export function createEscalateTool(handler: EscalationHandlerLike): Tool {
  return {
    name: "escalate",
    description:
      "Request graph modifications from the architect (Loom) when a node is " +
      "BLOCKED or has exhausted all retries. Provide a reason explaining why " +
      "escalation is needed, an optional suggested action, and optional details " +
      "about the failure. This tool should be called when the orchestrator " +
      "cannot resolve the issue on its own.",
    inputSchema: EscalateInputSchema,

    async execute(input: unknown, context: ToolContext): Promise<string> {
      try {
        const parsed = EscalateInputSchema.parse(input);

        const request: EscalationRequest = {
          reason: parsed.reason,
          nodeId: context.nodeId,
          agentId: context.agentId,
          suggestedAction: parsed.suggestedAction,
          details: parsed.details,
        };

        try {
          await handler.escalate(request);
        } catch {
          return (
            `Error: failed to escalate for node "${context.nodeId}" — ` +
            "the handler rejected the escalation request"
          );
        }

        return (
          `Escalation submitted — agent: ${context.agentId}, ` +
          `node: ${context.nodeId}, reason: ${parsed.reason}` +
          (parsed.suggestedAction ? `, suggested: ${parsed.suggestedAction}` : "")
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    },
  };
}
