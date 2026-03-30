import { Command } from "commander";

import { DaemonClient, readDaemonConfig } from "../client.js";

// ============================================================================
// Types
// ============================================================================

/** Shape of the POST /workflow/resume success response. */
interface ResumeInfo {
  /** ID of the first interrupted node that triggered the resume. */
  resumedFrom: string | null;
  /** IDs of completed nodes that will be skipped. */
  completedNodeIds: string[];
  /** IDs of interrupted nodes reset to pending. */
  resetNodeIds: string[];
  /** IDs of waiting nodes with recalculated delays. */
  rescheduledNodeIds: string[];
}

/** Shape of the POST /workflow/resume success response. */
interface ResumeResponse {
  status: string;
  resumeInfo: ResumeInfo;
}

/** Shape of an API error response. */
interface ErrorResponse {
  error: string;
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `resume` command for the loomflo CLI.
 *
 * Usage: `loomflo resume`
 *
 * Sends a resume request to the running daemon. The daemon reloads the
 * last workflow state, identifies completed and interrupted nodes, resets
 * interrupted nodes back to pending, recalculates scheduler delays, and
 * resumes execution.
 *
 * @returns A configured commander Command instance.
 */
export function createResumeCommand(): Command {
  const cmd = new Command("resume")
    .description("Resume a paused or interrupted workflow")
    .action(async (): Promise<void> => {
      /* ------------------------------------------------------------------ */
      /* Connect to daemon                                                  */
      /* ------------------------------------------------------------------ */

      let config;
      try {
        config = await readDaemonConfig();
      } catch {
        console.error("Daemon is not running. Start with: loomflo start");
        process.exit(1);
      }

      const client = new DaemonClient(config.port, config.token);

      /* ------------------------------------------------------------------ */
      /* Send resume request                                                */
      /* ------------------------------------------------------------------ */

      console.log("Resuming workflow...");

      const response = await client.post<ResumeResponse | ErrorResponse>("/workflow/resume");

      if (!response.ok) {
        const errorData = response.data as ErrorResponse;
        console.error(`Failed to resume: ${errorData.error}`);
        process.exit(1);
      }

      const data = response.data as ResumeResponse;
      const info = data.resumeInfo;

      /* ------------------------------------------------------------------ */
      /* Display resume summary                                             */
      /* ------------------------------------------------------------------ */

      console.log(`Workflow resumed. Status: ${data.status}`);
      console.log("");

      if (info.completedNodeIds.length > 0) {
        console.log(`  Completed (skipped): ${String(info.completedNodeIds.length)} nodes`);
      }

      if (info.resetNodeIds.length > 0) {
        console.log(`  Interrupted (reset): ${String(info.resetNodeIds.length)} nodes`);
        for (const nodeId of info.resetNodeIds) {
          console.log(`    - ${nodeId}`);
        }
      }

      if (info.rescheduledNodeIds.length > 0) {
        console.log(`  Rescheduled: ${String(info.rescheduledNodeIds.length)} nodes`);
      }

      if (info.resumedFrom !== null) {
        console.log(`  Resuming from: ${info.resumedFrom}`);
      }

      console.log("");
      console.log("Execution will continue from where it left off.");
    });

  return cmd;
}
