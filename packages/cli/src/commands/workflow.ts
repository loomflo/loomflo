// packages/cli/src/commands/workflow.ts
//
// `loomflo workflow` — top-level commands for managing workflow lifecycle
// outside the interactive onboarding wizard.
//
// Subcommands:
//   init <description>  — seed a workflow spec on an already-initialised
//                         project. Defaults to --wait (blocks until the
//                         spec transitions out of "spec"); --no-wait
//                         returns as soon as the daemon accepts the
//                         POST so the user can follow progress with
//                         `loomflo workflow watch`.
//   watch               — poll the active workflow's spec state and
//                         block until it transitions out of "spec".
//                         Useful after `loomflo init` (which is always
//                         fire-and-forget) or `workflow init --no-wait`.

import { Command } from "commander";
import { resolve } from "node:path";

import { ensureDaemonRunning } from "../daemon-control.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";
import { resolveProject } from "../project-resolver.js";
import { theme } from "../theme/index.js";
import {
  defaultWorkflowInitDeps,
  kickoffWorkflowInit,
  pollWorkflowSpec,
  runWorkflowInit,
  type WorkflowInitDeps,
} from "../workflow-init.js";

// ============================================================================
// Options
// ============================================================================

interface WorkflowInitFlags {
  projectPath?: string;
  json?: boolean;
  timeout?: string;
  wait?: boolean;
}

interface WorkflowWatchFlags {
  projectPath?: string;
  json?: boolean;
  timeout?: string;
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `workflow` top-level command with `init <description>` and
 * `watch` subcommands.
 *
 * `init` defaults to `--wait` (block until the spec finishes). The
 * rationale: a one-shot `loomflo workflow init "<description>"` is an
 * explicit, scripted invocation — users running it interactively want
 * the completion report printed inline, and scripts want the exit code
 * of the spec run itself. `--no-wait` is the escape hatch for callers
 * that prefer the onboarding-style fire-and-forget UX.
 *
 * The onboarding `loomflo init` path is always fire-and-forget; it
 * calls `kickoffWorkflowInit()` directly rather than going through
 * this command.
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
    .option(
      "--timeout <seconds>",
      "Abort polling after this many seconds (0 = no deadline, default)",
    )
    .option(
      "--wait",
      "Block until spec generation finishes (default; use --no-wait to return immediately)",
      true,
    )
    .option(
      "--no-wait",
      "Return as soon as the daemon accepts the init request; watch progress separately",
    )
    .action(async (description: string, opts: WorkflowInitFlags): Promise<void> => {
      const json = isJsonMode(opts);
      const wait = opts.wait !== false; // --no-wait flips to false
      const sp = json || !wait ? null : theme.spinner("generating spec…");
      try {
        const cwd = opts.projectPath ? resolve(opts.projectPath) : process.cwd();
        const { identity } = await resolveProject({ cwd, createIfMissing: false });
        const info = await ensureDaemonRunning();
        sp?.start();

        const timeoutMs = parseTimeoutSeconds(opts.timeout);
        const baseDeps = overrideDeps ?? defaultWorkflowInitDeps();
        const deps = timeoutMs !== undefined ? { ...baseDeps, timeoutMs } : baseDeps;

        if (!wait) {
          // Fire-and-forget: return as soon as the POST is accepted.
          const created = await kickoffWorkflowInit(
            { info, projectId: identity.id, projectPath: cwd, description },
            deps,
          );
          if (json) {
            writeJson({
              workflow: { id: created.id, status: created.status, nodeCount: 0 },
            });
            return;
          }
          process.stdout.write(
            `${theme.line(
              theme.glyph.check,
              "accent",
              `workflow ${theme.muted(created.id)} queued`,
              "spec generation running in the background",
            )}\n`,
          );
          process.stdout.write(
            `${theme.line(
              theme.glyph.arrow,
              "muted",
              "run loomflo workflow watch to follow progress",
            )}\n`,
          );
          return;
        }

        const result = await runWorkflowInit(
          { info, projectId: identity.id, projectPath: cwd, description },
          deps,
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

  const watch = new Command("watch")
    .description("Poll the active workflow's spec state and exit when it is ready")
    .option("--project-path <path>", "Project directory path")
    .option("--json", "Emit machine-readable JSON (no spinner, no colours)")
    .option(
      "--timeout <seconds>",
      "Abort polling after this many seconds (0 = no deadline, default)",
    )
    .action(async (opts: WorkflowWatchFlags): Promise<void> => {
      const json = isJsonMode(opts);
      const sp = json ? null : theme.spinner("waiting on spec…");
      try {
        const cwd = opts.projectPath ? resolve(opts.projectPath) : process.cwd();
        const { identity } = await resolveProject({ cwd, createIfMissing: false });
        const info = await ensureDaemonRunning();
        sp?.start();

        const timeoutMs = parseTimeoutSeconds(opts.timeout);
        const baseDeps = overrideDeps ?? defaultWorkflowInitDeps();
        const deps = timeoutMs !== undefined ? { ...baseDeps, timeoutMs } : baseDeps;

        // Fetch the current workflow once so we can print a meaningful
        // id on the timeout error. If there's no active workflow, bail
        // with a user-friendly hint rather than polling forever.
        const current = await deps.getWorkflow(info, identity.id);
        if (current === null) {
          sp?.fail();
          const e = new Error(
            "no active workflow — run loomflo workflow init \"<description>\" to seed one",
          ) as Error & { code?: string };
          e.code = "E_NO_WORKFLOW";
          throw e;
        }
        if (current.status !== "spec") {
          // Already past spec gen: nothing to watch, print the current
          // state and exit cleanly.
          sp?.succeed();
          const nodeCount = Object.keys(current.graph.nodes).length;
          if (json) {
            writeJson({
              workflow: { id: current.id, status: current.status, nodeCount },
            });
            return;
          }
          process.stdout.write(
            `${theme.line(
              theme.glyph.check,
              "accent",
              `workflow ${theme.muted(current.id)} ${current.status}`,
              `${String(nodeCount)} nodes`,
            )}\n`,
          );
          return;
        }

        const result = await pollWorkflowSpec(
          { info, projectId: identity.id, workflowId: current.id },
          deps,
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
  cmd.addCommand(withJsonSupport(watch));
  return cmd;
}

/**
 * Parse `--timeout <seconds>` into milliseconds.
 *
 * Returns `undefined` when the flag was not provided (caller keeps the
 * default), `0` when the caller asked for no deadline, otherwise the
 * value in ms. Throws a tagged Error on non-numeric / negative input.
 */
function parseTimeoutSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    const e = new Error(
      `invalid --timeout ${JSON.stringify(raw)} — expected a non-negative number of seconds (0 = no deadline)`,
    ) as Error & { code?: string };
    e.code = "E_WORKFLOW_FLAG";
    throw e;
  }
  return Math.round(n * 1000);
}
