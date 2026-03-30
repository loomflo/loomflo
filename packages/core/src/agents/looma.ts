/**
 * Looma (Worker) agent — executes a specific task within a workflow node.
 *
 * Each Looma is spawned by a Loomi (Orchestrator) and is responsible for:
 * - Writing code, creating files, and modifying existing files within its write scope
 * - Running shell commands to validate work (tests, builds, linting)
 * - Communicating with teammate workers via the MessageBus
 * - Reading/writing shared memory for cross-node context
 * - Calling report_complete when its task is finished
 *
 * Looma is the builder — it does the actual implementation work.
 */

import type { CostTracker } from "../costs/tracker.js";
import { createEvent, appendEvent } from "../persistence/events.js";
import type { LLMProvider } from "../providers/base.js";
import type { Tool } from "../tools/base.js";
import type { CompletionHandlerLike, CompletionReport } from "../tools/report-complete.js";
import { createReportCompleteTool } from "../tools/report-complete.js";
import { createSendMessageTool } from "../tools/send-message.js";
import type { EventType } from "../types.js";
import type { AgentLoopResult } from "./base-agent.js";
import { runAgentLoop } from "./base-agent.js";
import type { MessageBus } from "./message-bus.js";
import { buildLoomaPrompt } from "./prompts.js";

// ============================================================================
// LoomaConfig
// ============================================================================

/**
 * Configuration for running a single Looma (Worker) agent.
 *
 * Provides everything needed to execute a task: identity, scope, tools,
 * LLM provider, communication channels, and contextual information.
 */
export interface LoomaConfig {
  /** Unique worker identifier (e.g., "looma-auth-1"). */
  agentId: string;
  /** Node this worker belongs to. */
  nodeId: string;
  /** Description of what the worker should accomplish. */
  taskDescription: string;
  /** Glob patterns defining which files this worker may write. */
  writeScope: string[];
  /** Absolute path to the project workspace root. */
  workspacePath: string;
  /** LLM provider for completion calls. */
  provider: LLMProvider;
  /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
  model: string;
  /** Base tools for the worker (without send_message/report_complete — added internally). */
  tools: Tool[];
  /** Message bus for intra-node agent communication. */
  messageBus: MessageBus;
  /** External completion handler (e.g., the Loomi's CompletionTracker). */
  completionHandler: CompletionHandlerLike;
  /** Agent execution constraints. */
  config: {
    /** Wall-clock timeout in milliseconds. */
    agentTimeout: number;
    /** Cumulative token limit (input + output). */
    agentTokenLimit: number;
    /** Maximum tokens per individual LLM call. */
    maxTokens?: number;
  };
  /** Markdown instructions for the parent node. */
  nodeInstructions: string;
  /** Description of other workers in this node and their tasks. */
  teamContext?: string;
  /** Spec artifacts content for context. */
  specContext?: string;
  /** Shared memory snapshot for context. */
  sharedMemoryContent?: string;
  /** Context from a previous failed attempt (retry). */
  retryContext?: string;
  /** Cost tracker for recording LLM usage. */
  costTracker: CostTracker;
  /** Event log configuration. */
  eventLog: { workflowId: string };
}

// ============================================================================
// LoomaResult
// ============================================================================

/**
 * Result returned by {@link runLooma} after the worker completes.
 *
 * The function never throws — all outcomes (success, failure, timeout,
 * token exhaustion) are represented as structured results.
 */
export interface LoomaResult {
  /** How the worker terminated. */
  status: "completed" | "failed" | "timeout" | "token_limit";
  /** Final text output from the agent. */
  output: string;
  /** Cumulative token usage across all LLM calls. */
  tokenUsage: { input: number; output: number };
  /** Error description when status is not 'completed'. */
  error?: string;
  /** Structured completion report if the worker called report_complete. */
  completionReport?: CompletionReport;
}

// ============================================================================
// CompletionCapture
// ============================================================================

/**
 * Captures the report_complete payload locally while forwarding to an
 * external {@link CompletionHandlerLike}.
 *
 * This allows {@link runLooma} to access the completion report for inclusion
 * in {@link LoomaResult}, while the orchestrator's tracker also receives it.
 */
class CompletionCapture implements CompletionHandlerLike {
  private captured: CompletionReport | undefined;
  private readonly forward: CompletionHandlerLike;

  /**
   * @param forward - External handler to forward reports to (e.g., Loomi's CompletionTracker).
   */
  constructor(forward: CompletionHandlerLike) {
    this.forward = forward;
  }

  /**
   * Record a completion report, capturing it locally and forwarding to the external handler.
   *
   * @param agentId - ID of the agent reporting completion.
   * @param nodeId - ID of the node the agent belongs to.
   * @param report - Structured completion payload.
   * @returns Resolves when the external handler has accepted the report.
   */
  async reportComplete(agentId: string, nodeId: string, report: CompletionReport): Promise<void> {
    this.captured = report;
    await this.forward.reportComplete(agentId, nodeId, report);
  }

  /**
   * Get the captured completion report, if one was filed.
   *
   * @returns The completion report, or undefined if report_complete was not called.
   */
  getReport(): CompletionReport | undefined {
    return this.captured;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build the complete tool set for the Looma agent.
 *
 * Filters out any pre-existing send_message/report_complete tools from the
 * base set, then appends dynamically created versions wired to the provided
 * message bus and completion capture.
 *
 * @param baseTools - Static tools from the LoomaConfig.
 * @param messageBus - Message bus for the send_message tool.
 * @param capture - Completion capture for the report_complete tool.
 * @returns Complete tool array for the worker.
 */
function buildToolSet(
  baseTools: Tool[],
  messageBus: MessageBus,
  capture: CompletionCapture,
): Tool[] {
  const dynamicNames = new Set(["send_message", "report_complete"]);
  const filtered = baseTools.filter((t) => !dynamicNames.has(t.name));

  return [...filtered, createSendMessageTool(messageBus), createReportCompleteTool(capture)];
}

/**
 * Log an event to the project's events.jsonl file.
 *
 * @param config - Looma configuration providing workspace path and workflow ID.
 * @param type - Event type identifier.
 * @param details - Event-specific payload data.
 */
async function logEvent(
  config: LoomaConfig,
  type: EventType,
  details: Record<string, unknown>,
): Promise<void> {
  const event = createEvent({
    type,
    workflowId: config.eventLog.workflowId,
    nodeId: config.nodeId,
    agentId: config.agentId,
    details,
  });
  await appendEvent(config.workspacePath, event);
}

// ============================================================================
// runLooma
// ============================================================================

/**
 * Run a Looma (Worker) agent to execute a specific task within a workflow node.
 *
 * Executes the full worker lifecycle:
 * 1. Registers the agent on the MessageBus
 * 2. Builds the tool set with dynamically wired send_message and report_complete
 * 3. Constructs the system prompt via {@link buildLoomaPrompt}
 * 4. Runs the agent loop until completion or a limit is reached
 * 5. Records cost via the cost tracker
 * 6. Logs the outcome event
 * 7. Unregisters from the MessageBus
 *
 * This function never throws — all error conditions produce a {@link LoomaResult}
 * with an appropriate status and error message.
 *
 * @param config - Complete Looma configuration including task, tools, and constraints.
 * @returns Structured result with output, token usage, status, and optional completion report.
 */
export async function runLooma(config: LoomaConfig): Promise<LoomaResult> {
  const capture = new CompletionCapture(config.completionHandler);

  // Register on the MessageBus
  config.messageBus.registerAgent(config.agentId, config.nodeId);

  try {
    // Build tools with dynamically created send_message and report_complete
    const tools = buildToolSet(config.tools, config.messageBus, capture);

    // Build system prompt
    const systemPrompt = buildLoomaPrompt({
      taskDescription: config.taskDescription,
      fileScope: config.writeScope,
      nodeInstructions: config.nodeInstructions,
      teamContext: config.teamContext,
      specContext: config.specContext,
      sharedMemory: config.sharedMemoryContent,
      retryContext: config.retryContext,
    });

    // Log agent creation
    await logEvent(config, "agent_created", {
      role: "looma",
      taskDescription: config.taskDescription,
      writeScope: config.writeScope,
    });

    // Run the agent loop
    let loopResult: AgentLoopResult;
    try {
      loopResult = await runAgentLoop({
        systemPrompt,
        tools,
        provider: config.provider,
        model: config.model,
        maxTokens: config.config.maxTokens,
        timeout: config.config.agentTimeout,
        tokenLimit: config.config.agentTokenLimit,
        agentId: config.agentId,
        nodeId: config.nodeId,
        workspacePath: config.workspacePath,
        writeScope: config.writeScope,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await logEvent(config, "agent_failed", { error: errorMessage });
      return {
        status: "failed",
        output: "",
        tokenUsage: { input: 0, output: 0 },
        error: `Agent loop threw unexpectedly: ${errorMessage}`,
      };
    }

    // Record cost
    config.costTracker.recordCall(
      config.model,
      loopResult.tokenUsage.input,
      loopResult.tokenUsage.output,
      config.agentId,
      config.nodeId,
    );

    // Log outcome
    const eventType: EventType =
      loopResult.status === "completed" ? "agent_completed" : "agent_failed";
    await logEvent(config, eventType, {
      loopStatus: loopResult.status,
      tokenUsage: loopResult.tokenUsage,
      ...(loopResult.error !== undefined && { error: loopResult.error }),
    });

    // Build result
    const result: LoomaResult = {
      status: loopResult.status,
      output: loopResult.output,
      tokenUsage: loopResult.tokenUsage,
    };

    if (loopResult.error !== undefined) {
      result.error = loopResult.error;
    }

    const completionReport = capture.getReport();
    if (completionReport !== undefined) {
      result.completionReport = completionReport;
    }

    return result;
  } finally {
    // Always unregister from the MessageBus
    config.messageBus.unregisterAgent(config.agentId, config.nodeId);
  }
}
