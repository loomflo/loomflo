// packages/cli/src/commands/workflow.ts
//
// `loomflo workflow` — top-level commands for managing workflow lifecycle
// outside the interactive onboarding wizard.
//
// Subcommands:
//   init <description>  — seed a workflow spec on an already-initialised
//                         project and block until it transitions out of
//                         "spec" state (building / failed).

import { Command } from "commander";
import { resolve } from "node:path";

import { ensureDaemonRunning } from "../daemon-control.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";
import { resolveProject } from "../project-resolver.js";
import { theme } from "../theme/index.js";
import {
  defaultWorkflowInitDeps,
  runWorkflowInit,
  type WorkflowInitDeps,
} from "../workflow-init.js";

// ============================================================================
// Options
// ============================================================================

interface WorkflowInitFlags {
  projectPath?: string;
  json?: boolean;
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `workflow` top-level command with an `init <description>`
 * subcommand.
 *
 * @param overrideDeps - Optional override for workflow-init dependencies.
 *   Primarily useful for tests; production callers should omit it.
 * @returns A configured commander Command.
 */
export function createWorkflowCommand(overrideDeps?: WorkflowInitDeps): Command {
  const cmd = new Command("workflow").description("Manage the project workflow lifecycle");

  const init = new Command("init")
    .description("Seed a workflow spec on the current project")
    .argument("<description>", "Natural-language description of the workflow to generate")
    .option("--project-path <path>", "Project directory path")
    .option("--json", "Emit machine-readable JSON (no spinner, no colours)")
    .action(async (description: string, opts: WorkflowInitFlags): Promise<void> => {
      const json = isJsonMode(opts);
      const sp = json ? null : theme.spinner("generating spec…");
      try {
        const cwd = opts.projectPath ? resolve(opts.projectPath) : process.cwd();
        const { identity } = await resolveProject({ cwd, createIfMissing: false });
        const info = await ensureDaemonRunning();
        sp?.start();

        const result = await runWorkflowInit(
          { info, projectId: identity.id, projectPath: cwd, description },
          overrideDeps ?? defaultWorkflowInitDeps(),
        );
        sp?.succeed();

        if (json) {
          writeJson({
            workflow: { id: result.id, status: result.status, nodeCount: result.nodeCount },
          });
          return;
        }

        process.stdout.write(
          `${theme.line(
            theme.glyph.check,
            "accent",
            `workflow ${theme.muted(result.id)} ready`,
            `${String(result.nodeCount)} nodes`,
          )}\n`,
        );
        process.stdout.write(
          `${theme.line(theme.glyph.arrow, "muted", "run loomflo start to execute")}\n`,
        );
      } catch (err) {
        sp?.fail();
        const code = (err as { code?: string }).code ?? "E_WORKFLOW";
        writeError(opts, err instanceof Error ? err.message : String(err), code, err);
        process.exitCode = 1;
      }
    });

  cmd.addCommand(withJsonSupport(init));
  return cmd;
}
