import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";

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

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `resume` command for the loomflo CLI.
 *
 * Usage: `loomflo resume`
 *
 * Resolves the current project from the working directory and sends a
 * resume request to the running daemon. The daemon reloads the last
 * workflow state, identifies completed and interrupted nodes, resets
 * interrupted nodes back to pending, recalculates scheduler delays,
 * and resumes execution.
 *
 * @returns A configured commander Command instance.
 */
export function createResumeCommand(): Command {
  return new Command("resume")
    .description("Resume a paused or interrupted workflow")
    .action(async (): Promise<void> => {
      try {
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        const client = await openClient(identity.id);

        console.log("Resuming workflow...");

        const data = await client.request<ResumeResponse>("POST", "/workflow/resume");
        const info = data.resumeInfo;

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
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
