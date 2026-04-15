import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";

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
  return new Command("stop")
    .description("Stop this project's workflow (daemon keeps running)")
    .action(async () => {
      try {
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        const client = await openClient(identity.id);
        await client.request("POST", "/workflow/stop");
        console.log(`Project ${identity.name} (${identity.id}) stopped.`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
