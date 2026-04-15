import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";
import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme } from "../theme/index.js";

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
  const cmd = new Command("resume")
    .description("Resume a paused or interrupted workflow")
    .action(async (options: { json?: boolean }): Promise<void> => {
      const json = isJsonMode(options);
      const sp = json ? null : theme.spinner("resuming workflow\u2026");
      sp?.start();

      try {
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        const client = await openClient(identity.id);
        const data = await client.request<ResumeResponse>("POST", "/workflow/resume");
        sp?.succeed();
        const info = data.resumeInfo;

        if (json) {
          writeJson({ status: data.status, resumeInfo: info });
          return;
        }

        process.stdout.write(
          `${theme.line(theme.glyph.check, "accent", `workflow resumed`, data.status)}\n`,
        );

        if (info.completedNodeIds.length > 0) {
          process.stdout.write(`${theme.kv("skipped", `${String(info.completedNodeIds.length)} completed nodes`)}\n`);
        }
        if (info.resetNodeIds.length > 0) {
          process.stdout.write(`${theme.kv("reset", `${String(info.resetNodeIds.length)} interrupted nodes`)}\n`);
          for (const nodeId of info.resetNodeIds) {
            process.stdout.write(`${theme.line(theme.glyph.arrow, "muted", nodeId)}\n`);
          }
        }
        if (info.rescheduledNodeIds.length > 0) {
          process.stdout.write(`${theme.kv("resched.", `${String(info.rescheduledNodeIds.length)} nodes`)}\n`);
        }
        if (info.resumedFrom !== null) {
          process.stdout.write(`${theme.kv("from", info.resumedFrom)}\n`);
        }
      } catch (err) {
        sp?.fail();
        writeError(options, err instanceof Error ? err.message : String(err), "E_RESUME");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
