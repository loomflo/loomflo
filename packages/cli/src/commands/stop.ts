import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";
import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `stop` command for the loomflo CLI.
 *
 * Usage: `loomflo stop`
 *
 * Resolves the current project from the working directory and sends a
 * workflow-stop request to the running daemon. This stops the workflow
 * execution for this project; the daemon process itself continues running.
 *
 * Note: forcing the daemon process to terminate belongs to
 * `loomflo daemon stop --force` (T16).
 *
 * @returns A configured commander Command instance.
 */
export function createStopCommand(): Command {
  const cmd = new Command("stop")
    .description("Stop this project's workflow (daemon keeps running)")
    .action(async (options: { json?: boolean }): Promise<void> => {
      try {
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        const client = await openClient(identity.id);
        await client.request("POST", "/workflow/stop");

        if (isJsonMode(options)) {
          writeJson({ project: { id: identity.id, name: identity.name } });
          return;
        }

        process.stdout.write(
          `${theme.line(theme.glyph.check, "accent", `project ${identity.name} stopped`, identity.id)}\n`,
        );
      } catch (err) {
        writeError(options, (err as Error).message, "E_STOP");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
