/**
 * `loomflo nodes` — per-project node table.
 *
 * Lists nodes for a project in a colour-coded table. Supports `--all`
 * to include completed/failed nodes, `--project` to override cwd
 * resolution, and `--json` for machine-readable output.
 *
 * @module
 */

import { Command } from "commander";

import { readDaemonConfig } from "../client.js";
import { httpGet, type DaemonEndpoint } from "../observation/api.js";
import { withJsonSupport, isJsonMode, writeJson, writeError, type WithJsonOption } from "../output.js";
import { resolveProject } from "../project-resolver.js";
import { statusCell, formatUptime } from "./ps.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Types
// ============================================================================

/** Shape of a single node row returned by the daemon API. */
interface NodeRow {
  id: string;
  title: string;
  status: string;
  cost: number;
  agentCount: number;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

/** CLI options for the nodes command. */
interface NodesOptions extends WithJsonOption {
  project?: string;
  all?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute the duration string for a node.
 *
 * If `startedAt` is null the node has not started yet, so we return "—".
 * Otherwise we compute seconds from start to completedAt (or now) and
 * delegate to {@link formatUptime}.
 *
 * @param row - The node row.
 * @returns A compact duration string.
 */
function nodeDuration(row: NodeRow): string {
  if (row.startedAt == null) return "—";

  const start = new Date(row.startedAt).getTime();
  const end = row.completedAt != null ? new Date(row.completedAt).getTime() : Date.now();
  const seconds = Math.max(0, (end - start) / 1000);

  return formatUptime(seconds);
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `nodes` command for the loomflo CLI.
 *
 * Usage:
 *   `loomflo nodes`                — display active nodes for the current project
 *   `loomflo nodes --all`          — include completed and failed nodes
 *   `loomflo nodes --project <id>` — target a specific project by ID
 *   `loomflo nodes --json`         — emit the nodes array as JSON
 *
 * @returns A configured commander Command instance.
 */
export function createNodesCommand(): Command {
  const cmd = new Command("nodes")
    .description("List nodes for a project")
    .option("--project <id>", "Override cwd resolution with a specific project ID")
    .option("--all", "Include completed and failed nodes")
    .action(async (opts: NodesOptions): Promise<void> => {
      try {
        const daemon = await readDaemonConfig();

        // Resolve the project ID
        let projectId: string;
        if (opts.project != null) {
          projectId = opts.project;
        } else {
          const resolved = await resolveProject({
            cwd: process.cwd(),
            createIfMissing: false,
          });
          projectId = resolved.identity.id;
        }

        // Fetch nodes from the daemon
        const response = await httpGet<{ nodes: NodeRow[] }>(
          `/projects/${projectId}/nodes`,
          daemon as DaemonEndpoint,
        );

        let nodes = response.nodes;

        // Filter out completed/failed unless --all is set
        if (opts.all !== true) {
          nodes = nodes.filter(
            (n) => n.status !== "completed" && n.status !== "failed",
          );
        }

        // JSON output
        if (isJsonMode(opts)) {
          writeJson(nodes);
          return;
        }

        // Empty state
        if (nodes.length === 0) {
          process.stdout.write(
            `${theme.line(theme.glyph.arrow, "dim", "No nodes to display.")}\n`,
          );
          return;
        }

        // Table output
        const output = theme.table<NodeRow>(
          ["ID", "TITLE", "STATUS", "DUR", "COST", "RETRIES"],
          nodes,
          [
            { header: "ID", get: (r) => theme.dim(r.id) },
            { header: "TITLE", get: (r) => r.title },
            { header: "STATUS", get: (r) => statusCell(r.status) },
            { header: "DUR", get: (r) => nodeDuration(r), align: "right" },
            { header: "COST", get: (r) => `$${r.cost.toFixed(2)}`, align: "right" },
            { header: "RETRIES", get: (r) => String(r.retryCount), align: "right" },
          ],
        );

        process.stdout.write(`${output}\n`);
      } catch (err) {
        writeError(opts, (err as Error).message, "E_NODES");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
