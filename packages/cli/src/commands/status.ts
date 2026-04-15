import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";

// ============================================================================
// Types
// ============================================================================

/** Shape of a graph node within the workflow response. */
interface GraphNode {
  id: string;
  title: string;
  type: string;
}

/** Shape of a graph edge within the workflow response. */
interface GraphEdge {
  source: string;
  target: string;
}

/** Shape of the GET /workflow success response. */
interface WorkflowResponse {
  id: string;
  status: string;
  description: string;
  projectPath: string;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    topology: string;
  };
}

/** Shape of a single node entry in the costs response. */
interface CostNode {
  id: string;
  title: string;
  cost: number;
  retries: number;
}

/** Shape of the GET /costs success response. */
interface CostsResponse {
  total: number;
  budgetLimit: number | null;
  budgetRemaining: number | null;
  nodes: CostNode[];
  loomCost: number;
}

/** Shape of a single node entry in the nodes response. */
interface NodeEntry {
  id: string;
  title: string;
  status: string;
  agentCount: number;
  cost: number;
  retryCount: number;
}

// ============================================================================
// ANSI helpers
// ============================================================================

/** ANSI escape sequences for terminal styling. */
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
} as const;

/**
 * Preferred display order for node statuses.
 * Statuses not listed here are appended at the end.
 */
const STATUS_ORDER: readonly string[] = [
  "running",
  "review",
  "pending",
  "waiting",
  "blocked",
  "done",
  "failed",
];

/**
 * Return the ANSI color escape sequence for a given node status.
 *
 * @param status - The node status string.
 * @returns An ANSI escape string, or empty string for unknown statuses.
 */
function statusColor(status: string): string {
  switch (status) {
    case "running":
      return ANSI.green;
    case "done":
      return ANSI.cyan;
    case "failed":
      return ANSI.red;
    case "blocked":
      return ANSI.yellow;
    case "pending":
    case "waiting":
      return ANSI.dim;
    case "review":
      return ANSI.magenta;
    default:
      return "";
  }
}

/**
 * Wrap text with the ANSI color associated with a node status.
 * If the status has no mapped color, the text is returned unchanged.
 *
 * @param text - The visible text to colorize.
 * @param status - The node status used to determine the color.
 * @returns The text wrapped in ANSI escape sequences.
 */
function colorizeStatus(text: string, status: string): string {
  const color = statusColor(status);
  if (!color) return text;
  return `${color}${text}${ANSI.reset}`;
}

/**
 * Render a section header with bold + underline ANSI styling.
 *
 * @param title - The header text.
 * @returns The styled header string.
 */
function sectionHeader(title: string): string {
  return `${ANSI.bold}${ANSI.underline}${title}${ANSI.reset}`;
}

// ============================================================================
// Formatting helpers
// ============================================================================

/**
 * Format a numeric cost as a dollar string with 2 decimal places.
 *
 * @param value - The numeric cost value.
 * @returns A formatted string like "$1.23".
 */
function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Compute a human-readable elapsed time string from an ISO timestamp to now.
 * Output format: "Xh Ym Zs" (hours omitted when zero, minutes always shown
 * when hours are present).
 *
 * @param createdAt - An ISO 8601 date string representing the start time.
 * @returns A formatted elapsed time string (e.g. "2h 15m 8s").
 */
function formatElapsed(createdAt: string): string {
  const startMs = new Date(createdAt).getTime();
  let totalSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${String(hours)}h`);
  if (minutes > 0 || hours > 0) parts.push(`${String(minutes)}m`);
  parts.push(`${String(seconds)}s`);

  return parts.join(" ");
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `status` command for the loomflo CLI.
 *
 * Usage: `loomflo status`
 *
 * Resolves the current project from the working directory, connects to
 * the running daemon, and fetches the current workflow state, per-node
 * cost breakdown, and node statuses. Displays a structured summary
 * including workflow info, elapsed time, node summary, active nodes,
 * a per-node cost table with colored statuses, and budget information.
 *
 * @returns A configured commander Command instance.
 */
export function createStatusCommand(): Command {
  return new Command("status")
    .description("Show workflow status and costs")
    .action(async (): Promise<void> => {
      /* ------------------------------------------------------------------ */
      /* Resolve project and open scoped client                             */
      /* ------------------------------------------------------------------ */

      let projectId: string;
      try {
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        projectId = identity.id;
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
        return; // unreachable, satisfies TypeScript control flow
      }

      let client: Awaited<ReturnType<typeof openClient>>;
      try {
        client = await openClient(projectId);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
        return;
      }

      /* ------------------------------------------------------------------ */
      /* Fetch workflow, costs, and nodes in parallel                        */
      /* ------------------------------------------------------------------ */

      const [workflowResult, costsResult, nodesResult] = await Promise.allSettled([
        client.request<WorkflowResponse>("GET", "/workflow"),
        client.request<CostsResponse>("GET", "/costs"),
        client.request<NodeEntry[]>("GET", "/nodes"),
      ]);

      /* ------------------------------------------------------------------ */
      /* Handle no workflow (connection failure or 404)                     */
      /* ------------------------------------------------------------------ */

      if (workflowResult.status === "rejected") {
        const msg = (workflowResult.reason as Error).message;
        // A 404 means no active workflow; any other error is a connection problem.
        if (msg.includes("HTTP 404")) {
          console.log("No active workflow. Start one with: loomflo start");
          return;
        }
        console.error("Failed to connect to daemon.");
        process.exit(1);
        return;
      }

      const workflow = workflowResult.value;

      /* ------------------------------------------------------------------ */
      /* Workflow summary                                                    */
      /* ------------------------------------------------------------------ */

      console.log(sectionHeader("Workflow"));
      console.log(`  ID:          ${workflow.id}`);
      console.log(`  Status:      ${colorizeStatus(workflow.status, workflow.status)}`);
      console.log(`  Description: ${workflow.description}`);
      console.log(`  Elapsed:     ${formatElapsed(workflow.createdAt)}`);
      console.log("");

      /* ------------------------------------------------------------------ */
      /* Resolve nodes                                                      */
      /* ------------------------------------------------------------------ */

      let nodes: NodeEntry[] = [];
      if (nodesResult.status === "fulfilled") {
        nodes = nodesResult.value;
      }

      /* ------------------------------------------------------------------ */
      /* Nodes summary                                                      */
      /* ------------------------------------------------------------------ */

      if (nodes.length > 0) {
        const statusCounts = new Map<string, number>();
        for (const node of nodes) {
          statusCounts.set(node.status, (statusCounts.get(node.status) ?? 0) + 1);
        }

        const sortedStatuses = [...statusCounts.entries()].sort((a, b) => {
          const ai = STATUS_ORDER.indexOf(a[0]);
          const bi = STATUS_ORDER.indexOf(b[0]);
          return (ai === -1 ? STATUS_ORDER.length : ai) - (bi === -1 ? STATUS_ORDER.length : bi);
        });

        console.log(sectionHeader("Nodes Summary"));
        console.log(`  Total: ${String(nodes.length)}`);

        const summaryParts = sortedStatuses.map(
          ([status, count]) => `${colorizeStatus(status, status)}: ${String(count)}`,
        );
        console.log(`  ${summaryParts.join("  ")}`);
        console.log("");
      }

      /* ------------------------------------------------------------------ */
      /* Active nodes                                                       */
      /* ------------------------------------------------------------------ */

      const activeNodes = nodes.filter((n) => n.status === "running" || n.status === "review");

      if (activeNodes.length > 0) {
        console.log(sectionHeader("Active Nodes"));
        for (const node of activeNodes) {
          const coloredStatus = colorizeStatus(node.status, node.status);
          console.log(`  - ${node.title} [${coloredStatus}] (${String(node.agentCount)} agents)`);
        }
        console.log("");
      }

      /* ------------------------------------------------------------------ */
      /* Per-node cost table                                                 */
      /* ------------------------------------------------------------------ */

      if (nodes.length > 0) {
        console.log(sectionHeader("Node Costs"));

        const titleWidth = Math.max("Node".length, ...nodes.map((n) => n.title.length));
        const statusWidth = Math.max("Status".length, ...nodes.map((n) => n.status.length));

        const header =
          "  " +
          "Node".padEnd(titleWidth) +
          "  " +
          "Status".padEnd(statusWidth) +
          "  " +
          "Cost".padStart(10) +
          "  " +
          "Retries";
        const separator = "  " + "-".repeat(header.length - 2);

        console.log(header);
        console.log(separator);

        for (const node of nodes) {
          const paddedStatus = node.status.padEnd(statusWidth);
          const coloredStatus = colorizeStatus(paddedStatus, node.status);
          const line =
            "  " +
            node.title.padEnd(titleWidth) +
            "  " +
            coloredStatus +
            "  " +
            formatCost(node.cost).padStart(10) +
            "  " +
            String(node.retryCount);
          console.log(line);
        }
        console.log("");
      }

      /* ------------------------------------------------------------------ */
      /* Cost summary                                                        */
      /* ------------------------------------------------------------------ */

      if (costsResult.status === "fulfilled") {
        const costs = costsResult.value;

        console.log(sectionHeader("Cost Summary"));
        console.log(`  Total Cost:       ${formatCost(costs.total)}`);
        console.log(
          `  Budget Limit:     ${costs.budgetLimit !== null ? formatCost(costs.budgetLimit) : "None"}`,
        );
        console.log(
          `  Budget Remaining: ${costs.budgetRemaining !== null ? formatCost(costs.budgetRemaining) : "N/A"}`,
        );
        console.log(`  Loom Overhead:    ${formatCost(costs.loomCost)}`);
      }
    });
}
