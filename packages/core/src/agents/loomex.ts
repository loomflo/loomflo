/**
 * Loomex (Reviewer) agent — inspects work quality and produces structured verdicts.
 *
 * Each Loomex is spawned after workers complete a node. It is responsible for:
 * - Reading all files produced or modified by workers
 * - Checking each task against the node instructions and spec
 * - Producing a structured ReviewReport with PASS/FAIL/BLOCKED verdict
 * - Providing specific, actionable feedback for failures
 *
 * Loomex has READ-ONLY tools — it must NOT have write_file, edit_file,
 * exec_command, write_memory, send_message, or report_complete.
 */

import type { CostTracker } from '../costs/tracker.js';
import { createEvent, appendEvent } from '../persistence/events.js';
import type { LLMProvider } from '../providers/base.js';
import type { Tool } from '../tools/base.js';
import type { EventType, ReviewReport, TaskVerification } from '../types.js';
import { ReviewReportSchema } from '../types.js';
import type { AgentLoopResult } from './base-agent.js';
import { runAgentLoop } from './base-agent.js';
import { buildLoomexPrompt } from './prompts.js';

// ============================================================================
// LoomexConfig
// ============================================================================

/**
 * Configuration for running a single Loomex (Reviewer) agent.
 *
 * Provides everything needed to inspect a node's work: identity, read-only
 * tools, LLM provider, tasks to verify, and contextual information.
 */
export interface LoomexConfig {
  /** Unique reviewer identifier (e.g., "loomex-node-1"). */
  agentId: string;
  /** Node being reviewed. */
  nodeId: string;
  /** Human-readable node title. */
  nodeTitle: string;
  /** Markdown instructions for the node. */
  nodeInstructions: string;
  /** Tasks to verify, each with an ID and description. */
  tasksToVerify: Array<{ taskId: string; description: string }>;
  /** Absolute path to the project workspace root. */
  workspacePath: string;
  /** LLM provider for completion calls. */
  provider: LLMProvider;
  /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
  model: string;
  /** Read-only tools (read_file, search_files, list_files, read_memory). */
  tools: Tool[];
  /** Agent execution constraints. */
  config: {
    /** Wall-clock timeout in milliseconds. */
    agentTimeout: number;
    /** Cumulative token limit (input + output). */
    agentTokenLimit: number;
    /** Maximum tokens per individual LLM call. */
    maxTokens?: number;
  };
  /** Spec artifacts content for context. */
  specContext?: string;
  /** Shared memory snapshot for context. */
  sharedMemoryContent?: string;
  /** Cost tracker for recording LLM usage. */
  costTracker: CostTracker;
  /** Event log configuration. */
  eventLog: { workflowId: string };
}

// ============================================================================
// LoomexResult
// ============================================================================

/**
 * Result returned by {@link runLoomex} after the reviewer completes.
 *
 * The function never throws — all outcomes (success, failure, timeout,
 * token exhaustion) are represented as structured results.
 */
export interface LoomexResult {
  /** Structured review report with verdict and per-task details. */
  report: ReviewReport;
  /** Cumulative token usage across all LLM calls. */
  tokenUsage: { input: number; output: number };
  /** Error description if the agent failed before producing a report. */
  error?: string;
}

// ============================================================================
// Forbidden Tools
// ============================================================================

/** Tools that Loomex must never have access to (write/mutate tools). */
const FORBIDDEN_TOOLS = new Set([
  'write_file',
  'edit_file',
  'exec_command',
  'write_memory',
  'send_message',
  'report_complete',
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Filter out any forbidden tools from the tool set.
 *
 * Loomex is read-only — this ensures write/mutate tools are never passed
 * to the agent loop even if accidentally included in the config.
 *
 * @param tools - Input tool set from the LoomexConfig.
 * @returns Filtered tool set containing only read-only tools.
 */
function filterReadOnlyTools(tools: Tool[]): Tool[] {
  return tools.filter((t) => !FORBIDDEN_TOOLS.has(t.name));
}

/**
 * Log an event to the project's events.jsonl file.
 *
 * @param config - Loomex configuration providing workspace path and workflow ID.
 * @param type - Event type identifier.
 * @param details - Event-specific payload data.
 */
async function logEvent(
  config: LoomexConfig,
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

/**
 * Create a FAIL ReviewReport with the given error message.
 *
 * Used as a fallback when the agent fails or produces unparseable output.
 *
 * @param errorMessage - Description of what went wrong.
 * @param tasksToVerify - Tasks that should have been verified.
 * @returns A FAIL ReviewReport with all tasks marked as failed.
 */
function createFailReport(
  errorMessage: string,
  tasksToVerify: Array<{ taskId: string; description: string }>,
): ReviewReport {
  return {
    verdict: 'FAIL',
    tasksVerified: tasksToVerify.map((t) => ({
      taskId: t.taskId,
      status: 'fail' as const,
      details: 'Review could not be completed.',
    })),
    details: errorMessage,
    recommendation: 'Re-run the reviewer after resolving the underlying issue.',
    createdAt: new Date().toISOString(),
  };
}

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract a JSON object from text that may contain markdown fences or prose.
 *
 * Attempts parsing strategies in order:
 * 1. Direct JSON.parse of trimmed text
 * 2. Extract from markdown code fences
 * 3. Find the outermost curly braces
 *
 * @param text - Raw text from the LLM response.
 * @returns Parsed JSON value, or null if no valid JSON can be extracted.
 */
function extractJson(text: string): unknown | null {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to alternative strategies
  }

  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1] !== undefined) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Fall through
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // Fall through
    }
  }

  return null;
}

// ============================================================================
// Text-Based Fallback Parser
// ============================================================================

/**
 * Extract a verdict keyword from text output.
 *
 * Scans for PASS, FAIL, or BLOCKED keywords (case-insensitive) that appear
 * as standalone verdict declarations.
 *
 * @param text - Raw text from the LLM response.
 * @returns The verdict string or null if none found.
 */
function extractVerdict(text: string): 'PASS' | 'FAIL' | 'BLOCKED' | null {
  const verdictMatch = /\b(?:overall\s+)?verdict\s*:\s*(PASS|FAIL|BLOCKED)\b/i.exec(text);
  if (verdictMatch?.[1] !== undefined) {
    return verdictMatch[1].toUpperCase() as 'PASS' | 'FAIL' | 'BLOCKED';
  }

  const standaloneMatch = /\*\*?(PASS|FAIL|BLOCKED)\*?\*?/i.exec(text);
  if (standaloneMatch?.[1] !== undefined) {
    return standaloneMatch[1].toUpperCase() as 'PASS' | 'FAIL' | 'BLOCKED';
  }

  return null;
}

/**
 * Extract per-task statuses from text output using pattern matching.
 *
 * Scans for patterns like "[taskId]: pass", "taskId — fail", or
 * "taskId: blocked" to determine per-task results.
 *
 * @param text - Raw text from the LLM response.
 * @param tasksToVerify - Tasks that should have been verified.
 * @returns Array of TaskVerification objects.
 */
function extractTaskStatuses(
  text: string,
  tasksToVerify: Array<{ taskId: string; description: string }>,
): TaskVerification[] {
  const results: TaskVerification[] = [];

  for (const task of tasksToVerify) {
    const escapedId = task.taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskPattern = new RegExp(
      `${escapedId}[^\\n]*?(?:status|verdict|result)?\\s*[:—\\-]\\s*(pass|fail|blocked)`,
      'i',
    );
    const match = taskPattern.exec(text);

    if (match?.[1] !== undefined) {
      const status = match[1].toLowerCase() as 'pass' | 'fail' | 'blocked';
      const detailStart = text.indexOf(match[0]);
      const detailEnd = text.indexOf('\n', detailStart + match[0].length);
      const detail = detailEnd !== -1
        ? text.slice(detailStart, detailEnd).trim()
        : match[0].trim();

      results.push({
        taskId: task.taskId,
        status,
        details: detail,
      });
    } else {
      results.push({
        taskId: task.taskId,
        status: 'fail',
        details: 'Could not determine task status from reviewer output.',
      });
    }
  }

  return results;
}

/**
 * Parse text-based reviewer output into a ReviewReport using heuristic patterns.
 *
 * This is a fallback when the reviewer does not produce parseable JSON.
 * It scans for verdict keywords and per-task status patterns.
 *
 * @param text - Raw text from the LLM response.
 * @param tasksToVerify - Tasks that should have been verified.
 * @returns A ReviewReport built from extracted patterns.
 */
function parseTextBased(
  text: string,
  tasksToVerify: Array<{ taskId: string; description: string }>,
): ReviewReport {
  const verdict = extractVerdict(text) ?? 'FAIL';
  const tasksVerified = extractTaskStatuses(text, tasksToVerify);

  const recommendationMatch = /(?:recommendation|suggested action|next steps?)\s*[:—]\s*([^\n]+(?:\n(?!##|\*\*)[^\n]+)*)/i.exec(text);
  const recommendation = recommendationMatch?.[1]?.trim() ?? 'Review the detailed findings above.';

  return {
    verdict,
    tasksVerified,
    details: text.slice(0, 2000),
    recommendation,
    createdAt: new Date().toISOString(),
  };
}

// ============================================================================
// parseReviewReport
// ============================================================================

/**
 * Parse the agent's text output into a structured ReviewReport.
 *
 * Attempts parsing strategies in order:
 * 1. JSON extraction (direct parse, markdown fences, brace extraction)
 *    followed by Zod schema validation
 * 2. Text-based fallback: scan for verdict keywords and per-task patterns
 * 3. If all parsing fails: generate a FAIL report with the raw output
 *
 * @param text - Raw text output from the agent loop.
 * @param tasksToVerify - Tasks that should have been verified.
 * @returns A valid ReviewReport matching the ReviewReportSchema.
 */
export function parseReviewReport(
  text: string,
  tasksToVerify: Array<{ taskId: string; description: string }>,
): ReviewReport {
  if (text.length === 0) {
    return createFailReport(
      'Reviewer produced no output.',
      tasksToVerify,
    );
  }

  // Strategy 1: Try JSON extraction + Zod validation
  const json = extractJson(text);
  if (json !== null) {
    const parseResult = ReviewReportSchema.safeParse(json);
    if (parseResult.success) {
      return parseResult.data;
    }

    // JSON was found but doesn't match schema — try to salvage fields
    const partial = json as Record<string, unknown>;
    if (typeof partial['verdict'] === 'string') {
      const verdictUpper = partial['verdict'].toUpperCase();
      if (verdictUpper === 'PASS' || verdictUpper === 'FAIL' || verdictUpper === 'BLOCKED') {
        const tasksVerified = Array.isArray(partial['tasksVerified'])
          ? salvageTaskVerifications(partial['tasksVerified'], tasksToVerify)
          : tasksToVerify.map((t) => ({
              taskId: t.taskId,
              status: 'fail' as const,
              details: 'Task verification data missing from report.',
            }));

        return {
          verdict: verdictUpper as 'PASS' | 'FAIL' | 'BLOCKED',
          tasksVerified,
          details: typeof partial['details'] === 'string'
            ? partial['details']
            : 'Details not provided in expected format.',
          recommendation: typeof partial['recommendation'] === 'string'
            ? partial['recommendation']
            : 'Review the detailed findings.',
          createdAt: new Date().toISOString(),
        };
      }
    }
  }

  // Strategy 2: Text-based fallback
  const verdict = extractVerdict(text);
  if (verdict !== null) {
    return parseTextBased(text, tasksToVerify);
  }

  // Strategy 3: All parsing failed — generate FAIL report with raw output
  return createFailReport(
    `Reviewer output could not be parsed into a structured report. Raw output:\n${text.slice(0, 2000)}`,
    tasksToVerify,
  );
}

// ============================================================================
// Salvage Helpers
// ============================================================================

/**
 * Attempt to salvage task verification data from a partially valid JSON array.
 *
 * Iterates through the raw array entries, extracting taskId, status, and
 * details fields where possible. Falls back to defaults for missing tasks.
 *
 * @param rawTasks - Raw array from the JSON response.
 * @param tasksToVerify - Expected tasks for cross-referencing.
 * @returns Array of TaskVerification objects covering all expected tasks.
 */
function salvageTaskVerifications(
  rawTasks: unknown[],
  tasksToVerify: Array<{ taskId: string; description: string }>,
): TaskVerification[] {
  const parsed = new Map<string, TaskVerification>();

  for (const raw of rawTasks) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    const taskId = typeof entry['taskId'] === 'string' ? entry['taskId'] : undefined;
    if (taskId === undefined) continue;

    const rawStatus = typeof entry['status'] === 'string' ? entry['status'].toLowerCase() : 'fail';
    const status = (rawStatus === 'pass' || rawStatus === 'fail' || rawStatus === 'blocked')
      ? rawStatus
      : 'fail';

    parsed.set(taskId, {
      taskId,
      status,
      details: typeof entry['details'] === 'string' ? entry['details'] : 'No details provided.',
    });
  }

  return tasksToVerify.map((t) =>
    parsed.get(t.taskId) ?? {
      taskId: t.taskId,
      status: 'fail' as const,
      details: 'Task not found in reviewer response.',
    },
  );
}

// ============================================================================
// runLoomex
// ============================================================================

/**
 * Run a Loomex (Reviewer) agent to inspect work quality for a workflow node.
 *
 * Executes the full reviewer lifecycle:
 * 1. Filters tools to ensure read-only access
 * 2. Builds the system prompt via {@link buildLoomexPrompt}
 * 3. Logs the reviewer_started event
 * 4. Runs the agent loop until completion or a limit is reached
 * 5. Parses the agent's output into a structured ReviewReport
 * 6. Records cost via the cost tracker
 * 7. Logs the reviewer_verdict event
 *
 * This function never throws — all error conditions produce a {@link LoomexResult}
 * with a FAIL report and error message.
 *
 * @param config - Complete Loomex configuration including tasks, tools, and constraints.
 * @returns Structured result with ReviewReport, token usage, and optional error.
 */
export async function runLoomex(config: LoomexConfig): Promise<LoomexResult> {
  try {
    // Ensure only read-only tools are available
    const tools = filterReadOnlyTools(config.tools);

    // Build system prompt
    const systemPrompt = buildLoomexPrompt({
      nodeTitle: config.nodeTitle,
      nodeInstructions: config.nodeInstructions,
      tasksToVerify: config.tasksToVerify,
      specContext: config.specContext,
      sharedMemory: config.sharedMemoryContent,
    });

    // Log reviewer started
    await logEvent(config, 'reviewer_started', {
      nodeTitle: config.nodeTitle,
      tasksToVerify: config.tasksToVerify.map((t) => t.taskId),
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
        writeScope: [], // Loomex has no write scope
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await logEvent(config, 'reviewer_verdict', {
        verdict: 'FAIL',
        error: errorMessage,
      });
      const report = createFailReport(
        `Agent loop threw unexpectedly: ${errorMessage}`,
        config.tasksToVerify,
      );
      return {
        report,
        tokenUsage: { input: 0, output: 0 },
        error: errorMessage,
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

    // Parse the review report from the agent's output
    const report = parseReviewReport(loopResult.output, config.tasksToVerify);

    // Log verdict
    await logEvent(config, 'reviewer_verdict', {
      verdict: report.verdict,
      tasksVerified: report.tasksVerified.length,
      loopStatus: loopResult.status,
    });

    // Build result
    const result: LoomexResult = {
      report,
      tokenUsage: loopResult.tokenUsage,
    };

    if (loopResult.status !== 'completed') {
      result.error = loopResult.error ?? `Agent loop ended with status: ${loopResult.status}`;
    }

    return result;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const report = createFailReport(
      `Loomex failed unexpectedly: ${errorMessage}`,
      config.tasksToVerify,
    );
    return {
      report,
      tokenUsage: { input: 0, output: 0 },
      error: errorMessage,
    };
  }
}
