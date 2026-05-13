/**
 * `loomflo tree` — print the workflow DAG for a project.
 *
 * Fetches the workflow graph from the daemon and renders it as an
 * ASCII tree using Unicode box-drawing characters. Supports `--json`
 * for machine-readable output and `--project <id>` for targeting a
 * specific project.
 *
 * @module
 */

import { Command } from "commander";

import { readDaemonConfig } from "../client.js";
import { httpGet } from "../observation/api.js";
import { resolveProject } from "../project-resolver.js";
import { withJsonSupport, isJsonMode, writeJson, writeError, type WithJsonOption } from "../output.js";
import { renderTree, type Graph } from "../observation/tree.js";

// ============================================================================
// Command Factory
// ============================================================================

interface TreeOptions extends WithJsonOption {
  project?: string;
}

/**
 * Create the `tree` command for the loomflo CLI.
 *
 * Usage:
 *   `loomflo tree`                — render the DAG for the current project
 *   `loomflo tree --project <id>` — render the DAG for a specific project
 *   `loomflo tree --json`         — emit the graph as JSON
 *
 * @returns A configured commander Command instance.
 */
export function createTreeCommand(): Command {
  const cmd = new Command("tree")
    .description("Print the workflow DAG for a project")
    .option("--project <id>", "Target project ID")
    .action(async (opts: TreeOptions): Promise<void> => {
      try {
        const daemon = await readDaemonConfig();

        let projectId: string;
        let projectName: string;

        if (opts.project) {
          projectId = opts.project;
          projectName = opts.project;
        } else {
          const { identity } = await resolveProject({
            cwd: process.cwd(),
            createIfMissing: false,
          });
          projectId = identity.id;
          projectName = identity.name;
        }

        const { graph } = await httpGet<{ graph: Graph }>(
          `/projects/${projectId}/workflow`,
          daemon,
        );

        if (isJsonMode(opts)) {
          writeJson(graph);
          return;
        }

        process.stdout.write(renderTree(projectName, graph) + "\n");
      } catch (err) {
        writeError(opts, (err as Error).message, "E_TREE");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
