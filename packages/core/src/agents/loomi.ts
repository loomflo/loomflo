/**
 * Loomi (Orchestrator) agent — manages a single node's execution in Loomflo 2.
 *
 * There is exactly one Loomi per node. It is responsible for:
 * - Reading node instructions and analyzing the work required
 * - Planning a team of Worker agents (Loomas) via an LLM planning call
 * - Assigning exclusive, non-overlapping file write scopes to each worker
 * - Spawning all workers in parallel via Promise.all
 * - Monitoring report_complete signals from workers
 * - Handling retry on FAIL verdict: adapting prompts and relaunching failed workers
 * - Escalating to the Architect (Loom) on BLOCKED or max retries exhausted
 *
 * Loomi does NOT write project code — it plans, coordinates, and supervises.
 */

import picomatch from "picomatch";
import { z } from "zod";
import type { Config } from "../config.js";
import type { CostTracker } from "../costs/tracker.js";
import type { SharedMemoryManager } from "../memory/shared-memory.js";
import { createEvent, appendEvent } from "../persistence/events.js";
import { parseDelay } from "../workflow/scheduler.js";
import type { LLMProvider } from "../providers/base.js";
import type { AgentInfo, EventType, ReviewReport } from "../types.js";
import type { AgentLoopResult } from "./base-agent.js";
import { runAgentLoop } from "./base-agent.js";
import type { MessageBus } from "./message-bus.js";
import { buildLoomaPrompt } from "./prompts.js";
import type { Tool } from "../tools/base.js";
import type { EscalationHandlerLike } from "../tools/escalate.js";
import { isOAuthTokenValid } from "../providers/credentials.js";
import type { CompletionHandlerLike, CompletionReport } from "../tools/report-complete.js";
import { createReportCompleteTool } from "../tools/report-complete.js";
import { createSendMessageTool } from "../tools/send-message.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Plan for a single worker agent as determined by Loomi's planning phase.
 */
export interface WorkerPlan {
  /** Unique worker identifier (e.g., "looma-auth-1"). */
  id: string;
  /** Description of the task assigned to this worker. */
  taskDescription: string;
  /** Glob patterns defining the worker's exclusive file write scope. */
  writeScope: string[];
}

/**
 * Complete team plan produced by Loomi's LLM planning call.
 */
export interface TeamPlan {
  /** LLM's reasoning for the team composition. */
  reasoning: string;
  /** Individual worker plans. */
  workers: WorkerPlan[];
}

/**
 * Configuration for running a Loomi orchestrator.
 *
 * @param nodeId - Unique node identifier this Loomi manages.
 * @param nodeTitle - Human-readable node title.
 * @param instructions - Markdown instructions for this node.
 * @param workspacePath - Absolute path to the project workspace root.
 * @param provider - LLM provider for planning and worker calls.
 * @param model - LLM model for Loomi's own planning calls.
 * @param config - Merged workflow configuration.
 * @param messageBus - Message bus for intra-node agent communication.
 * @param eventLog - Event log configuration with workflowId.
 * @param costTracker - Cost tracker for LLM usage accounting.
 * @param sharedMemory - Shared memory manager for cross-node state.
 * @param escalationHandler - Handler for escalating to the Architect (Loom).
 * @param workerTools - Base tools for worker agents (without send_message and report_complete).
 * @param specContext - Spec artifacts content for worker context.
 * @param sharedMemoryContent - Shared memory content snapshot for worker context.
 * @param reviewCallback - Callback to trigger review after workers complete.
 */
export interface LoomiConfig {
  /** Unique node identifier this Loomi manages. */
  nodeId: string;
  /** Human-readable node title. */
  nodeTitle: string;
  /** Markdown instructions for this node. */
  instructions: string;
  /** Absolute path to the project workspace root. */
  workspacePath: string;
  /** LLM provider for planning and worker agent calls. */
  provider: LLMProvider;
  /** LLM model for Loomi's own planning calls. */
  model: string;
  /** Merged workflow configuration. */
  config: Config;
  /** Message bus for intra-node agent communication. */
  messageBus: MessageBus;
  /** Event log configuration. */
  eventLog: { workflowId: string };
  /** Cost tracker for LLM usage accounting. */
  costTracker: CostTracker;
  /** Shared memory manager for cross-node state. */
  sharedMemory: SharedMemoryManager;
  /** Handler for escalating to the Architect (Loom). */
  escalationHandler: EscalationHandlerLike;
  /** Base tools for worker agents (without send_message and report_complete). */
  workerTools: Tool[];
  /** Spec artifacts content for worker context. */
  specContext?: string;
  /** Shared memory content snapshot for worker context. */
  sharedMemoryContent?: string;
  /** Callback to trigger review after workers complete. Returns null if review is disabled. */
  reviewCallback?: () => Promise<ReviewReport | null>;
}

/**
 * Result returned by {@link runLoomi} after orchestration completes.
 *
 * @param status - Final orchestration outcome.
 * @param completedAgents - Agent IDs that completed successfully.
 * @param failedAgents - Agent IDs that failed or did not report completion.
 * @param retryCount - Number of retry cycles executed.
 */
export interface LoomiResult {
  /** Final orchestration outcome. */
  status: "completed" | "failed" | "blocked" | "escalated";
  /** Agent IDs that reported successful completion. */
  completedAgents: string[];
  /** Agent IDs that failed or did not report completion. */
  failedAgents: string[];
  /** Number of retry cycles executed. */
  retryCount: number;
}

// ============================================================================
// Zod Schemas for LLM Response Parsing
// ============================================================================

/** Schema for a single worker in the LLM team plan response. */
const WorkerPlanSchema = z.object({
  id: z.string(),
  taskDescription: z.string(),
  writeScope: z.array(z.string()).min(1),
});

/** Schema for the full team plan from the LLM response. */
const TeamPlanSchema = z.object({
  reasoning: z.string(),
  workers: z.array(WorkerPlanSchema).min(1),
});

// ============================================================================
// CompletionTracker
// ============================================================================

/**
 * Tracks report_complete signals from worker agents.
 *
 * Implements {@link CompletionHandlerLike} to receive completion reports
 * via the report_complete tool, and provides query methods for determining
 * which workers have finished successfully.
 */
class CompletionTracker implements CompletionHandlerLike {
  private readonly reports = new Map<string, CompletionReport>();

  /**
   * Record a completion report from a worker agent.
   *
   * @param agentId - ID of the agent reporting completion.
   * @param _nodeId - Node ID (unused, present for interface compliance).
   * @param report - Structured completion payload.
   * @returns Resolves when the report has been stored.
   */
  reportComplete(agentId: string, _nodeId: string, report: CompletionReport): Promise<void> {
    this.reports.set(agentId, report);
    return Promise.resolve();
  }

  /**
   * Get the completion report for a specific agent.
   *
   * @param agentId - Agent identifier to look up.
   * @returns The completion report, or undefined if the agent has not reported.
   */
  getReport(agentId: string): CompletionReport | undefined {
    return this.reports.get(agentId);
  }

  /**
   * Clear all tracked reports between retry cycles.
   */
  clear(): void {
    this.reports.clear();
  }
}

// ============================================================================
// Planning Prompts
// ============================================================================

/**
 * Build the system prompt for the team planning LLM call.
 *
 * @param maxWorkers - Maximum number of workers allowed, or null for unlimited.
 * @returns System prompt string for the planning call.
 */
function buildPlanningSystemPrompt(maxWorkers: number | null): string {
  const maxWorkerLine =
    maxWorkers !== null
      ? `You MUST NOT plan more than ${String(maxWorkers)} worker(s).`
      : "There is no limit on the number of workers.";

  return [
    "You are Loomi, the Orchestrator agent in the Loomflo AI agent framework.",
    "Your task is to analyze node instructions and plan a team of Worker agents (Loomas).",
    "",
    "Rules:",
    "- Each worker must have a clear, specific task description.",
    "- Each worker must have an exclusive file write scope defined as glob patterns.",
    "- File write scopes MUST NOT overlap between workers — no two workers may write to the same file.",
    '- Use descriptive worker IDs prefixed with "looma-" (e.g., "looma-auth-1", "looma-api-routes-1").',
    `- ${maxWorkerLine}`,
    "- If the work is small enough for one worker, plan one worker. Do not split unnecessarily.",
    "",
    "Respond with ONLY a JSON object in this exact format (no markdown, no explanation outside the JSON):",
    "{",
    '  "reasoning": "Brief explanation of why you are dividing the work this way",',
    '  "workers": [',
    "    {",
    '      "id": "looma-descriptive-name-1",',
    '      "taskDescription": "Detailed description of what this worker should accomplish",',
    '      "writeScope": ["glob/pattern/**/*.ts"]',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

/**
 * Build the user message for the team planning LLM call.
 *
 * @param nodeTitle - Human-readable node title.
 * @param instructions - Markdown instructions for the node.
 * @param specContext - Optional spec artifacts content.
 * @param sharedMemoryContent - Optional shared memory snapshot.
 * @returns Formatted user message string.
 */
function buildPlanningUserMessage(
  nodeTitle: string,
  instructions: string,
  specContext?: string,
  sharedMemoryContent?: string,
): string {
  const parts = [`## Node: ${nodeTitle}`, "", "## Instructions", instructions];

  if (specContext !== undefined && specContext.length > 0) {
    parts.push("", "## Spec Context", specContext);
  }

  if (sharedMemoryContent !== undefined && sharedMemoryContent.length > 0) {
    parts.push("", "## Shared Memory", sharedMemoryContent);
  }

  return parts.join("\n");
}

/**
 * Build the system prompt for adapting failed worker prompts on retry.
 *
 * @returns System prompt string for the retry adaptation call.
 */
function buildRetryPlanningSystemPrompt(): string {
  return [
    "You are Loomi, the Orchestrator agent. Some of your workers failed their tasks.",
    "Generate adapted task descriptions that incorporate the reviewer feedback.",
    "",
    "Rules:",
    "- Only generate plans for the failed workers listed below.",
    "- Keep the same worker IDs and file write scopes — only adapt the task descriptions.",
    "- Address the specific issues raised in the review feedback.",
    "- Be more specific and explicit about what the worker should do differently.",
    "",
    "Respond with ONLY a JSON object in this exact format (no markdown, no explanation outside the JSON):",
    "{",
    '  "reasoning": "What changes you are making to address the feedback",',
    '  "workers": [',
    "    {",
    '      "id": "existing-worker-id",',
    '      "taskDescription": "Adapted task description addressing the feedback",',
    '      "writeScope": ["same/scope/as/before/**"]',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

/**
 * Build the user message for the retry planning LLM call.
 *
 * @param failedPlans - Plans for the workers that failed.
 * @param reviewFeedback - Feedback from the Loomex reviewer.
 * @param originalInstructions - Original node instructions.
 * @returns Formatted user message for retry planning.
 */
function buildRetryUserMessage(
  failedPlans: WorkerPlan[],
  reviewFeedback: string,
  originalInstructions: string,
): string {
  const planDescriptions = failedPlans
    .map((p) => `- ${p.id}: ${p.taskDescription} (scope: ${p.writeScope.join(", ")})`)
    .join("\n");

  return [
    "## Failed Workers",
    planDescriptions,
    "",
    "## Review Feedback",
    reviewFeedback,
    "",
    "## Original Node Instructions",
    originalInstructions,
  ].join("\n");
}

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract a JSON object from an LLM response that may contain markdown fences.
 *
 * Attempts parsing strategies in order:
 * 1. Direct JSON.parse of trimmed text
 * 2. Extract from markdown code fences
 * 3. Find the outermost curly braces
 *
 * @param text - Raw text from the LLM response.
 * @returns Parsed JSON value.
 * @throws Error if no valid JSON can be extracted.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to alternative strategies
  }

  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1] !== undefined) {
    return JSON.parse(fenceMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Failed to extract JSON from LLM response");
}

// ============================================================================
// File Scope Validation
// ============================================================================

/**
 * Validate that worker file write scopes do not overlap.
 *
 * Tests each worker's glob patterns against every other worker's patterns
 * by generating representative test paths and checking for dual matches.
 *
 * @param workers - Array of worker plans with write scopes.
 * @returns Validation result with `valid` boolean and any overlaps found.
 */
function validateFileScopes(workers: WorkerPlan[]): { valid: boolean; overlaps: string[] } {
  const overlaps: string[] = [];

  for (let i = 0; i < workers.length; i++) {
    const a = workers[i] as WorkerPlan;
    for (let j = i + 1; j < workers.length; j++) {
      const b = workers[j] as WorkerPlan;

      const matcherA = picomatch(a.writeScope);
      const matcherB = picomatch(b.writeScope);

      const testPaths = generateTestPaths([...a.writeScope, ...b.writeScope]);

      for (const testPath of testPaths) {
        if (matcherA(testPath) && matcherB(testPath)) {
          overlaps.push(`Workers "${a.id}" and "${b.id}" both match "${testPath}"`);
          break;
        }
      }
    }
  }

  return { valid: overlaps.length === 0, overlaps };
}

/**
 * Generate representative file paths from glob patterns for overlap testing.
 *
 * Converts glob wildcards into literal placeholder segments that the
 * original glob would match, producing concrete paths for comparison.
 *
 * @param patterns - Glob patterns to derive test paths from.
 * @returns Array of unique concrete test paths.
 */
function generateTestPaths(patterns: string[]): string[] {
  const paths = new Set<string>();

  for (const pattern of patterns) {
    let path = pattern.replace(/\*\*/g, "a/b");
    path = path.replace(/\*/g, "test.file");
    path = path.replace(/\{([^}]+)\}/g, (_match, group: string) => {
      const first = group.split(",")[0];
      return first ?? "x";
    });
    path = path.replace(/\?/g, "x");
    paths.add(path);
  }

  return Array.from(paths);
}

// ============================================================================
// Worker Helpers
// ============================================================================

/**
 * Build the team context string describing other workers in the node.
 *
 * @param currentId - ID of the current worker (excluded from the list).
 * @param allPlans - All worker plans in the team.
 * @returns Formatted team context string for the worker's prompt.
 */
function buildTeamContext(currentId: string, allPlans: WorkerPlan[]): string {
  const others = allPlans.filter((p) => p.id !== currentId);
  if (others.length === 0) {
    return "You are the only worker in this node.";
  }

  const lines = others.map(
    (p) => `- ${p.id}: ${p.taskDescription} (writes to: ${p.writeScope.join(", ")})`,
  );

  return ["Your teammates in this node:", ...lines].join("\n");
}

/**
 * Create an {@link AgentInfo} metadata object for a planned worker.
 *
 * @param plan - The worker plan.
 * @param model - LLM model for the worker.
 * @returns AgentInfo for the worker in 'created' status.
 */
export function createWorkerAgentInfo(plan: WorkerPlan, model: string): AgentInfo {
  return {
    id: plan.id,
    role: "looma",
    model,
    status: "created",
    writeScope: [...plan.writeScope],
    taskDescription: plan.taskDescription,
    tokenUsage: { input: 0, output: 0 },
    cost: 0,
  };
}

/**
 * Build the complete tool set for a worker agent.
 *
 * Combines the base tools from config with dynamically created
 * send_message and report_complete tools. Filters out any pre-existing
 * tools with conflicting names to avoid duplicates.
 *
 * @param baseTools - Static tools from the LoomiConfig.
 * @param messageBus - Message bus for the send_message tool.
 * @param completionTracker - Tracker for the report_complete tool.
 * @returns Complete tool array for the worker.
 */
function buildWorkerTools(
  baseTools: Tool[],
  messageBus: MessageBus,
  completionTracker: CompletionTracker,
): Tool[] {
  const dynamicNames = new Set(["send_message", "report_complete"]);
  const filtered = baseTools.filter((t) => !dynamicNames.has(t.name));

  return [
    ...filtered,
    createSendMessageTool(messageBus),
    createReportCompleteTool(completionTracker),
  ];
}

// ============================================================================
// Event Logging & Progress
// ============================================================================

/**
 * Log an event to the project's events.jsonl file.
 *
 * @param config - Loomi configuration providing workspace path and workflow ID.
 * @param loomiAgentId - Loomi agent ID for event attribution.
 * @param type - Event type identifier.
 * @param details - Event-specific payload data.
 */
async function logEvent(
  config: LoomiConfig,
  loomiAgentId: string,
  type: EventType,
  details: Record<string, unknown>,
): Promise<void> {
  const event = createEvent({
    type,
    workflowId: config.eventLog.workflowId,
    nodeId: config.nodeId,
    agentId: loomiAgentId,
    details,
  });
  await appendEvent(config.workspacePath, event);
}

/**
 * Write a progress update to the PROGRESS.md shared memory file.
 *
 * @param config - Loomi configuration providing shared memory manager.
 * @param agentId - Agent ID for write attribution.
 * @param content - Markdown content to append.
 */
async function writeProgress(config: LoomiConfig, agentId: string, content: string): Promise<void> {
  await config.sharedMemory.write("PROGRESS.md", content, agentId);
}

// ============================================================================
// Core Planning Functions
// ============================================================================

/**
 * Plan a team of workers by making an LLM call to analyze node instructions.
 *
 * Sends a structured planning prompt to the LLM and parses the JSON response
 * into a validated {@link TeamPlan}. Enforces the maxLoomasPerLoomi constraint
 * and ensures worker IDs are unique.
 *
 * @param config - Loomi configuration with provider, model, and node details.
 * @returns The validated team plan with worker assignments.
 * @throws Error if the LLM call fails or returns unparseable output.
 */
async function planTeam(config: LoomiConfig): Promise<TeamPlan> {
  const maxWorkers = config.config.maxLoomasPerLoomi;
  const systemPrompt = buildPlanningSystemPrompt(maxWorkers);
  const userMessage = buildPlanningUserMessage(
    config.nodeTitle,
    config.instructions,
    config.specContext,
    config.sharedMemoryContent,
  );

  const response = await config.provider.complete({
    messages: [{ role: "user", content: userMessage }],
    system: systemPrompt,
    model: config.model,
  });

  const loomiAgentId = `loomi-${config.nodeId}`;
  config.costTracker.recordCall(
    config.model,
    response.usage.inputTokens,
    response.usage.outputTokens,
    loomiAgentId,
    config.nodeId,
  );

  const textBlocks = response.content.filter(
    (block): block is { type: "text"; text: string } => block.type === "text",
  );
  const responseText = textBlocks.map((b) => b.text).join("\n");

  if (responseText.length === 0) {
    throw new Error("LLM returned empty response for team planning");
  }

  const json = extractJson(responseText);
  const plan = TeamPlanSchema.parse(json);

  if (maxWorkers !== null && plan.workers.length > maxWorkers) {
    plan.workers = plan.workers.slice(0, maxWorkers);
  }

  const seenIds = new Set<string>();
  for (const worker of plan.workers) {
    if (seenIds.has(worker.id)) {
      worker.id = `${worker.id}-${String(seenIds.size + 1)}`;
    }
    seenIds.add(worker.id);
  }

  return plan;
}

/**
 * Generate adapted worker plans for a retry cycle via an LLM call.
 *
 * Sends the original failed worker plans and review feedback to the LLM,
 * requesting adapted task descriptions. Worker IDs and file scopes are
 * preserved from the original plans.
 *
 * @param config - Loomi configuration with provider and model.
 * @param failedPlans - Plans for the workers that failed.
 * @param reviewFeedback - Feedback from the Loomex reviewer.
 * @returns Adapted worker plans with updated task descriptions.
 * @throws Error if the LLM call fails or returns unparseable output.
 */
async function adaptPlansForRetry(
  config: LoomiConfig,
  failedPlans: WorkerPlan[],
  reviewFeedback: string,
): Promise<WorkerPlan[]> {
  const systemPrompt = buildRetryPlanningSystemPrompt();
  const userMessage = buildRetryUserMessage(failedPlans, reviewFeedback, config.instructions);

  const response = await config.provider.complete({
    messages: [{ role: "user", content: userMessage }],
    system: systemPrompt,
    model: config.model,
  });

  const loomiAgentId = `loomi-${config.nodeId}`;
  config.costTracker.recordCall(
    config.model,
    response.usage.inputTokens,
    response.usage.outputTokens,
    loomiAgentId,
    config.nodeId,
  );

  const textBlocks = response.content.filter(
    (block): block is { type: "text"; text: string } => block.type === "text",
  );
  const responseText = textBlocks.map((b) => b.text).join("\n");

  if (responseText.length === 0) {
    throw new Error("LLM returned empty response for retry planning");
  }

  const json = extractJson(responseText);
  const adaptedPlan = TeamPlanSchema.parse(json);

  return failedPlans.map((original) => {
    const adapted = adaptedPlan.workers.find((w) => w.id === original.id);
    return {
      id: original.id,
      taskDescription: adapted?.taskDescription ?? original.taskDescription,
      writeScope: original.writeScope,
    };
  });
}

// ============================================================================
// Worker Spawning
// ============================================================================

/**
 * Spawn a single worker agent and run its agent loop to completion.
 *
 * Creates the Looma system prompt with team context, configures the
 * agent loop with the worker's tools and constraints, and runs it.
 *
 * @param config - Loomi configuration.
 * @param plan - Worker plan with task description and file scope.
 * @param allPlans - All worker plans (for team context in the prompt).
 * @param tools - Complete tool set for the worker.
 * @param retryContext - Optional context from a previous failed attempt.
 * @returns The agent loop result.
 */
async function spawnWorker(
  config: LoomiConfig,
  plan: WorkerPlan,
  allPlans: WorkerPlan[],
  tools: Tool[],
  retryContext?: string,
): Promise<AgentLoopResult> {
  const teamContext = buildTeamContext(plan.id, allPlans);
  const workerModel = config.config.models.looma;

  const systemPrompt = buildLoomaPrompt({
    taskDescription: plan.taskDescription,
    fileScope: plan.writeScope,
    nodeInstructions: config.instructions,
    teamContext,
    specContext: config.specContext,
    sharedMemory: config.sharedMemoryContent,
    retryContext,
  });

  return runAgentLoop(
    {
      systemPrompt,
      tools,
      provider: config.provider,
      model: workerModel,
      timeout: config.config.agentTimeout,
      tokenLimit: config.config.agentTokenLimit,
      agentId: plan.id,
      nodeId: config.nodeId,
      workspacePath: config.workspacePath,
      writeScope: plan.writeScope,
    },
    [{ role: "user", content: "Begin your work. Follow your instructions and use the available tools to complete your tasks." }],
  );
}

/**
 * Determine which workers completed and which failed based on their
 * agent loop results and completion reports.
 *
 * A worker is considered completed if its agent loop returned 'completed'
 * status and it did not report 'partial' via report_complete. A worker is
 * considered failed if the agent loop returned a non-completed status or
 * it reported partial completion.
 *
 * @param plans - Worker plans that were executed.
 * @param results - Agent loop results in the same order as plans.
 * @param tracker - Completion tracker with report_complete data.
 * @returns Object with completedIds and failedIds arrays.
 */
function classifyWorkerResults(
  plans: WorkerPlan[],
  results: AgentLoopResult[],
  tracker: CompletionTracker,
): { completedIds: string[]; failedIds: string[] } {
  const completedIds: string[] = [];
  const failedIds: string[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i] as WorkerPlan;
    const result = results[i] as AgentLoopResult;
    const report = tracker.getReport(plan.id);

    if (result.status !== "completed") {
      failedIds.push(plan.id);
    } else if (report !== undefined && report.status !== "success") {
      failedIds.push(plan.id);
    } else {
      completedIds.push(plan.id);
    }
  }

  return { completedIds, failedIds };
}

// ============================================================================
// Escalation
// ============================================================================

/**
 * Handle escalation to the Architect (Loom) and return a structured result.
 *
 * Logs the escalation event, calls the escalation handler, writes progress,
 * and returns the appropriate {@link LoomiResult}.
 *
 * @param config - Loomi configuration.
 * @param loomiAgentId - Loomi agent ID for logging.
 * @param reason - Human-readable escalation reason.
 * @param details - Additional context about the failure.
 * @param completedAgents - Agent IDs that completed before escalation.
 * @param failedAgents - Agent IDs that failed.
 * @param retryCount - Number of retries attempted before escalation.
 * @returns LoomiResult with 'escalated' status.
 */
async function handleEscalation(
  config: LoomiConfig,
  loomiAgentId: string,
  reason: string,
  details: string,
  completedAgents: string[],
  failedAgents: string[],
  retryCount: number,
): Promise<LoomiResult> {
  await logEvent(config, loomiAgentId, "escalation_triggered", {
    reason,
    details,
  });

  await config.escalationHandler.escalate({
    reason,
    nodeId: config.nodeId,
    agentId: loomiAgentId,
    suggestedAction: "modify_node",
    details,
  });

  await writeProgress(config, loomiAgentId, `## Escalated to Architect\nReason: ${reason}\n`);

  return {
    status: "escalated",
    completedAgents,
    failedAgents,
    retryCount,
  };
}

// ============================================================================
// Per-Task Retry Limits
// ============================================================================

/**
 * Increment per-task retry counters and partition workers into eligible and exhausted.
 *
 * Workers already in the permanently failed set are excluded before processing.
 * Each remaining worker's counter is incremented. Workers exceeding the per-task
 * limit are classified as exhausted.
 *
 * @param workers - Failed worker plans to evaluate.
 * @param taskRetryTracker - Map of worker ID to cumulative retry count.
 * @param maxRetriesPerTask - Maximum retries allowed per individual task.
 * @param permanentlyFailed - Worker IDs already permanently failed.
 * @returns Partitioned workers: eligible for retry and newly exhausted.
 */
function applyPerTaskRetryLimits(
  workers: WorkerPlan[],
  taskRetryTracker: Map<string, number>,
  maxRetriesPerTask: number,
  permanentlyFailed: string[],
): { eligible: WorkerPlan[]; exhausted: WorkerPlan[] } {
  const failedSet = new Set(permanentlyFailed);
  const retryable = workers.filter((p) => !failedSet.has(p.id));

  for (const plan of retryable) {
    const current = taskRetryTracker.get(plan.id) ?? 0;
    taskRetryTracker.set(plan.id, current + 1);
  }

  const eligible = retryable.filter((p) => (taskRetryTracker.get(p.id) ?? 0) <= maxRetriesPerTask);
  const exhausted = retryable.filter((p) => (taskRetryTracker.get(p.id) ?? 0) > maxRetriesPerTask);

  return { eligible, exhausted };
}

// ============================================================================
// runLoomi
// ============================================================================

/**
 * Run the Loomi orchestrator for a workflow node.
 *
 * Executes the full orchestration lifecycle:
 * 1. Plans a team of workers via an LLM call analyzing node instructions
 * 2. Validates non-overlapping file write scopes using picomatch
 * 3. Spawns all workers in parallel via Promise.all
 * 4. Monitors report_complete signals from each worker
 * 5. If review is enabled (via reviewCallback), triggers review
 * 6. On FAIL verdict, generates adapted prompts and relaunches only failed workers
 * 7. On BLOCKED or max retries exhausted, escalates to the Architect (Loom)
 *
 * This function never throws — all error conditions produce a {@link LoomiResult}
 * with an appropriate status.
 *
 * @param config - Complete Loomi configuration including node details,
 *   LLM provider, tools, and optional review callback.
 * @returns Structured result with orchestration outcome, agent statuses,
 *   and retry count.
 */
export async function runLoomi(config: LoomiConfig): Promise<LoomiResult> {
  const loomiAgentId = `loomi-${config.nodeId}`;
  const completionTracker = new CompletionTracker();
  const maxRetries = config.config.maxRetriesPerNode;
  let retryCount = 0;
  const allCompletedAgents: string[] = [];
  const taskRetryTracker = new Map<string, number>();
  const maxRetriesPerTask = config.config.maxRetriesPerTask;
  const permanentlyFailedAgents: string[] = [];

  // ---- Phase 1: Plan the team ----

  await logEvent(config, loomiAgentId, "node_started", {
    nodeTitle: config.nodeTitle,
  });
  await writeProgress(
    config,
    loomiAgentId,
    `## Node "${config.nodeTitle}" — Orchestration Started\nPlanning team...\n`,
  );

  let teamPlan: TeamPlan;
  try {
    teamPlan = await planTeam(config);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await logEvent(config, loomiAgentId, "node_failed", {
      error: `Planning failed: ${message}`,
    });
    await writeProgress(config, loomiAgentId, `## Planning Failed\n${message}\n`);
    return { status: "failed", completedAgents: [], failedAgents: [], retryCount: 0 };
  }

  await writeProgress(
    config,
    loomiAgentId,
    `## Team Planned\n${teamPlan.reasoning}\nWorkers: ${String(teamPlan.workers.length)}\n` +
      teamPlan.workers.map((p) => `- ${p.id}: ${p.taskDescription}`).join("\n") +
      "\n",
  );

  // ---- Phase 2: Validate file scopes ----

  const scopeValidation = validateFileScopes(teamPlan.workers);
  if (!scopeValidation.valid) {
    await writeProgress(
      config,
      loomiAgentId,
      `## File Scope Overlap Detected — Replanning\n${scopeValidation.overlaps.join("\n")}\n`,
    );

    try {
      const retryPlan = await planTeam(config);
      const revalidation = validateFileScopes(retryPlan.workers);
      if (!revalidation.valid) {
        await logEvent(config, loomiAgentId, "node_failed", {
          error: "File scope overlap persists after replanning",
          overlaps: revalidation.overlaps,
        });
        return { status: "failed", completedAgents: [], failedAgents: [], retryCount: 0 };
      }
      teamPlan = retryPlan;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await logEvent(config, loomiAgentId, "node_failed", {
        error: `Replanning failed: ${message}`,
      });
      return { status: "failed", completedAgents: [], failedAgents: [], retryCount: 0 };
    }
  }

  // ---- Phase 3: Spawn workers with retry loop ----

  let activePlans = [...teamPlan.workers];
  const workerTools = buildWorkerTools(config.workerTools, config.messageBus, completionTracker);

  config.messageBus.registerAgent(loomiAgentId, config.nodeId);

  try {
    while (retryCount <= maxRetries) {
      completionTracker.clear();

      // Register active workers with MessageBus
      for (const plan of activePlans) {
        config.messageBus.registerAgent(plan.id, config.nodeId);
      }

      // Log agent creation events
      for (const plan of activePlans) {
        await logEvent(config, loomiAgentId, "agent_created", {
          agentId: plan.id,
          role: "looma",
          taskDescription: plan.taskDescription,
          writeScope: plan.writeScope,
          retry: retryCount > 0,
        });
      }

      const retryContext =
        retryCount > 0
          ? `This is retry attempt ${String(retryCount)}. Address the issues from the previous attempt.`
          : undefined;

      const retryDetails =
        retryCount > 0
          ? "\n" +
            activePlans
              .map(
                (p) =>
                  `  - ${p.id} (task retry ${String(taskRetryTracker.get(p.id) ?? 0)}/${String(maxRetriesPerTask)})`,
              )
              .join("\n") +
            "\n"
          : "";

      await writeProgress(
        config,
        loomiAgentId,
        retryCount > 0
          ? `## Retry ${String(retryCount)} — Relaunching ${String(activePlans.length)} worker(s)${retryDetails}\n`
          : `## Spawning ${String(activePlans.length)} worker(s)\n`,
      );

      // Spawn all workers in parallel
      const workerResults = await Promise.all(
        activePlans.map((plan) =>
          spawnWorker(config, plan, teamPlan.workers, workerTools, retryContext),
        ),
      );

      // Track costs and log agent outcomes
      for (let i = 0; i < activePlans.length; i++) {
        const plan = activePlans[i] as WorkerPlan;
        const result = workerResults[i] as AgentLoopResult;

        config.costTracker.recordCall(
          config.config.models.looma,
          result.tokenUsage.input,
          result.tokenUsage.output,
          plan.id,
          config.nodeId,
        );

        const agentEventType: EventType =
          result.status === "completed" ? "agent_completed" : "agent_failed";
        await logEvent(config, loomiAgentId, agentEventType, {
          agentId: plan.id,
          loopStatus: result.status,
          ...(result.error !== undefined && { error: result.error }),
        });
      }

      // Unregister workers from MessageBus
      for (const plan of activePlans) {
        config.messageBus.unregisterAgent(plan.id, config.nodeId);
      }

      // Classify results
      const { completedIds, failedIds } = classifyWorkerResults(
        activePlans,
        workerResults,
        completionTracker,
      );

      allCompletedAgents.push(...completedIds);

      await writeProgress(
        config,
        loomiAgentId,
        `## Workers Finished\nCompleted: ${completedIds.join(", ") || "none"}\n` +
          `Failed: ${failedIds.join(", ") || "none"}\n`,
      );

      // ---- Handle results ----

      if (failedIds.length === 0) {
        // All workers completed — check review if enabled
        if (config.reviewCallback !== undefined) {
          await logEvent(config, loomiAgentId, "reviewer_started", {});
          const reviewReport = await config.reviewCallback();

          if (reviewReport === null || reviewReport.verdict === "PASS") {
            if (reviewReport !== null) {
              await logEvent(config, loomiAgentId, "reviewer_verdict", { verdict: "PASS" });
            }
            await logEvent(config, loomiAgentId, "node_completed", { retryCount });
            await writeProgress(config, loomiAgentId, `## Node Completed Successfully\n`);
            return {
              status: "completed",
              completedAgents: allCompletedAgents,
              failedAgents: [],
              retryCount,
            };
          }

          await logEvent(config, loomiAgentId, "reviewer_verdict", {
            verdict: reviewReport.verdict,
          });

          if (reviewReport.verdict === "BLOCKED") {
            return await handleEscalation(
              config,
              loomiAgentId,
              `Node "${config.nodeTitle}" is BLOCKED: ${reviewReport.details}`,
              reviewReport.recommendation,
              allCompletedAgents,
              [],
              retryCount,
            );
          }

          // FAIL verdict — retry if possible
          if (retryCount >= maxRetries) {
            return await handleEscalation(
              config,
              loomiAgentId,
              `Node "${config.nodeTitle}" exhausted ${String(maxRetries)} retries: ${reviewReport.details}`,
              `${reviewReport.recommendation}${permanentlyFailedAgents.length > 0 ? `\nPermanently failed workers (per-task limit): ${permanentlyFailedAgents.join(", ")}` : ""}`,
              allCompletedAgents,
              permanentlyFailedAgents,
              retryCount,
            );
          }

          // Identify failed tasks from review and map to worker plans
          const failedTaskIds = reviewReport.tasksVerified
            .filter((t) => t.status !== "pass")
            .map((t) => t.taskId);

          const failedWorkerPlans = teamPlan.workers.filter(
            (p) => failedTaskIds.includes(p.id) || failedTaskIds.length === 0,
          );

          const candidatePlans =
            failedWorkerPlans.length > 0 ? failedWorkerPlans : [...teamPlan.workers];

          // Apply per-task retry limits
          const { eligible: reviewEligible, exhausted: reviewExhausted } = applyPerTaskRetryLimits(
            candidatePlans,
            taskRetryTracker,
            maxRetriesPerTask,
            permanentlyFailedAgents,
          );

          if (reviewExhausted.length > 0) {
            permanentlyFailedAgents.push(...reviewExhausted.map((p) => p.id));
            await writeProgress(
              config,
              loomiAgentId,
              `## Per-task retry limit reached\n` +
                `Permanently failed: ${reviewExhausted.map((p) => p.id).join(", ")}\n`,
            );
          }

          if (reviewEligible.length === 0) {
            return await handleEscalation(
              config,
              loomiAgentId,
              `Node "${config.nodeTitle}" — all failed workers exhausted per-task retry limit (${String(maxRetriesPerTask)})`,
              `Permanently failed workers: ${permanentlyFailedAgents.join(", ")}`,
              allCompletedAgents,
              permanentlyFailedAgents,
              retryCount,
            );
          }

          activePlans = reviewEligible;

          await logEvent(config, loomiAgentId, "retry_triggered", {
            retryCount: retryCount + 1,
            failedWorkers: activePlans.map((p) => p.id),
            taskRetryCounts: Object.fromEntries(taskRetryTracker),
            permanentlyFailed: permanentlyFailedAgents,
          });

          const feedback = `${reviewReport.details}\n\nRecommendation: ${reviewReport.recommendation}`;
          try {
            activePlans = await adaptPlansForRetry(config, activePlans, feedback);
          } catch {
            await writeProgress(
              config,
              loomiAgentId,
              `## Prompt adaptation failed, retrying with original plans\n`,
            );
          }

          retryCount++;

          // Wait between retries if configured (e.g., "2h" to avoid API overload)
          const retryDelayMs = parseDelay(config.config.retryDelay);
          if (retryDelayMs > 0) {
            await writeProgress(config, loomiAgentId, `## Waiting ${config.config.retryDelay} before retry ${String(retryCount)}...\n`);
            await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
          }

          // After the delay, verify the OAuth token is still valid before respawning workers.
          // If expired, surface a clear message and bail out — the user must refresh first.
          const isOAuth = config.provider.isOAuthMode === true;
          if (isOAuth) {
            const tokenStillValid = await isOAuthTokenValid();
            if (!tokenStillValid) {
              await writeProgress(
                config,
                loomiAgentId,
                `## OAuth token expired — refresh with 'claude --print' then resume the workflow\n`,
              );
              return {
                status: "failed",
                completedAgents: allCompletedAgents,
                failedAgents: activePlans.map((p) => p.id),
                retryCount,
              };
            }
          }

          continue;
        }

        // No review callback — all workers completed successfully
        await logEvent(config, loomiAgentId, "node_completed", { retryCount });
        await writeProgress(config, loomiAgentId, `## Node Completed Successfully\n`);
        return {
          status: "completed",
          completedAgents: allCompletedAgents,
          failedAgents: [],
          retryCount,
        };
      }

      // Some workers failed — retry if possible
      if (retryCount >= maxRetries) {
        const allFailed = [...new Set([...failedIds, ...permanentlyFailedAgents])];
        return await handleEscalation(
          config,
          loomiAgentId,
          `Node "${config.nodeTitle}" has ${String(failedIds.length)} failed worker(s) after ${String(maxRetries)} retries`,
          `Failed workers: ${failedIds.join(", ")}${permanentlyFailedAgents.length > 0 ? `\nPermanently failed (per-task limit): ${permanentlyFailedAgents.join(", ")}` : ""}`,
          allCompletedAgents,
          allFailed,
          retryCount,
        );
      }

      const failedWorkerPlans = teamPlan.workers.filter((p) => failedIds.includes(p.id));

      // Apply per-task retry limits
      const { eligible: workerEligible, exhausted: workerExhausted } = applyPerTaskRetryLimits(
        failedWorkerPlans,
        taskRetryTracker,
        maxRetriesPerTask,
        permanentlyFailedAgents,
      );

      if (workerExhausted.length > 0) {
        permanentlyFailedAgents.push(...workerExhausted.map((p) => p.id));
        await writeProgress(
          config,
          loomiAgentId,
          `## Per-task retry limit reached\n` +
            `Permanently failed: ${workerExhausted.map((p) => p.id).join(", ")}\n`,
        );
      }

      if (workerEligible.length === 0) {
        return await handleEscalation(
          config,
          loomiAgentId,
          `Node "${config.nodeTitle}" — all failed workers exhausted per-task retry limit (${String(maxRetriesPerTask)})`,
          `Permanently failed workers: ${permanentlyFailedAgents.join(", ")}`,
          allCompletedAgents,
          permanentlyFailedAgents,
          retryCount,
        );
      }

      activePlans = workerEligible;

      await logEvent(config, loomiAgentId, "retry_triggered", {
        retryCount: retryCount + 1,
        failedWorkers: activePlans.map((p) => p.id),
        taskRetryCounts: Object.fromEntries(taskRetryTracker),
        permanentlyFailed: permanentlyFailedAgents,
      });

      retryCount++;

      // Wait between retries if configured (e.g., "2h" to avoid API overload)
      const retryDelayMs = parseDelay(config.config.retryDelay);
      if (retryDelayMs > 0) {
        await writeProgress(config, loomiAgentId, `## Waiting ${config.config.retryDelay} before retry ${String(retryCount)}...\n`);
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      }

      // After the delay, verify the OAuth token is still valid before respawning workers.
      // If expired, surface a clear message and bail out — the user must refresh first.
      const isOAuthRetry = config.provider.isOAuthMode === true;
      if (isOAuthRetry) {
        const tokenStillValid = await isOAuthTokenValid();
        if (!tokenStillValid) {
          await writeProgress(
            config,
            loomiAgentId,
            `## OAuth token expired — refresh with 'claude --print' then resume the workflow\n`,
          );
          return {
            status: "failed",
            completedAgents: allCompletedAgents,
            failedAgents: permanentlyFailedAgents,
            retryCount,
          };
        }
      }
    }
  } finally {
    config.messageBus.unregisterAgent(loomiAgentId, config.nodeId);
  }

  return {
    status: "failed",
    completedAgents: allCompletedAgents,
    failedAgents: permanentlyFailedAgents,
    retryCount,
  };
}
