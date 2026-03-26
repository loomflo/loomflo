import { z } from 'zod';
import type { Tool, ToolContext } from './base.js';

// ============================================================================
// CompletionReport
// ============================================================================

/**
 * Structured payload describing the outcome of a Looma's task execution.
 *
 * Sent by a worker agent (Looma) to its orchestrator (Loomi) via the
 * {@link CompletionHandlerLike} to signal that its assigned task is finished.
 */
export interface CompletionReport {
  /** Human-readable summary of what the agent accomplished. */
  summary: string;
  /** Absolute or workspace-relative paths of files the agent created. */
  filesCreated: string[];
  /** Absolute or workspace-relative paths of files the agent modified. */
  filesModified: string[];
  /** Whether the task completed fully or only partially. */
  status: 'success' | 'partial';
}

// ============================================================================
// CompletionHandlerLike
// ============================================================================

/**
 * Minimal interface for the completion handler dependency.
 *
 * Defines only the subset of behaviour needed by the report_complete tool,
 * avoiding a hard dependency on a concrete orchestrator implementation.
 * Any object satisfying this interface can be injected at runtime.
 */
export interface CompletionHandlerLike {
  /**
   * Record a completion report from an agent.
   *
   * @param agentId - ID of the agent reporting completion.
   * @param nodeId - ID of the node the agent belongs to.
   * @param report - Structured completion payload.
   * @returns Resolves when the report has been accepted.
   */
  reportComplete(agentId: string, nodeId: string, report: CompletionReport): Promise<void>;
}

// ============================================================================
// Input Schema
// ============================================================================

/** Zod schema for report_complete tool input. */
const ReportCompleteInputSchema = z.object({
  /** Summary of what was accomplished. */
  summary: z.string().describe('Summary of what was accomplished during the task'),
  /** Files created during the task (paths relative to workspace root). */
  filesCreated: z
    .array(z.string())
    .optional()
    .default([])
    .describe('List of file paths created during the task'),
  /** Files modified during the task (paths relative to workspace root). */
  filesModified: z
    .array(z.string())
    .optional()
    .default([])
    .describe('List of file paths modified during the task'),
  /** Whether the task completed fully or only partially. */
  status: z
    .enum(['success', 'partial'])
    .optional()
    .default('success')
    .describe('Completion status: "success" for full completion, "partial" for incomplete work'),
});

// ============================================================================
// createReportCompleteTool
// ============================================================================

/**
 * Create a report_complete tool wired to the given completion handler.
 *
 * Uses a factory pattern so the tool can access a {@link CompletionHandlerLike}
 * instance without requiring it on {@link ToolContext}. The tool uses
 * `context.agentId` and `context.nodeId` to identify the reporting agent.
 *
 * Only Looma (worker) agents use this tool. When a Looma finishes its task,
 * it calls report_complete to signal the Loomi (orchestrator) that it is done.
 * The Loomi collects these reports to determine when all workers have finished.
 *
 * @param handler - The completion handler that receives reports.
 * @returns A {@link Tool} that reports task completion via the provided handler.
 */
export function createReportCompleteTool(handler: CompletionHandlerLike): Tool {
  return {
    name: 'report_complete',
    description:
      'Signal the orchestrator (Loomi) that this worker agent has finished its task. ' +
      'Provide a summary of what was done, lists of files created and modified, and ' +
      'a status indicating success or partial completion. This tool should be called ' +
      'exactly once when the assigned task is complete.',
    inputSchema: ReportCompleteInputSchema,

    async execute(input: unknown, context: ToolContext): Promise<string> {
      try {
        const parsed = ReportCompleteInputSchema.parse(input);

        const report: CompletionReport = {
          summary: parsed.summary,
          filesCreated: parsed.filesCreated,
          filesModified: parsed.filesModified,
          status: parsed.status,
        };

        try {
          await handler.reportComplete(context.agentId, context.nodeId, report);
        } catch {
          return (
            `Error: failed to report completion for agent "${context.agentId}" ` +
            `in node "${context.nodeId}" — the handler rejected the report`
          );
        }

        const filesSummary: string[] = [];
        if (report.filesCreated.length > 0) {
          filesSummary.push(`created: ${report.filesCreated.join(', ')}`);
        }
        if (report.filesModified.length > 0) {
          filesSummary.push(`modified: ${report.filesModified.join(', ')}`);
        }

        return (
          `Completion reported — agent: ${context.agentId}, ` +
          `node: ${context.nodeId}, status: ${report.status}` +
          (filesSummary.length > 0 ? `, ${filesSummary.join('; ')}` : '')
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    },
  };
}
