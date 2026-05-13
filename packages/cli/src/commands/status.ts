import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";
import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Types
// ============================================================================

interface GraphNode {
  id: string;
  title: string;
  type: string;
}

interface GraphEdge {
  source: string;
  target: string;
}

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

interface CostNode {
  id: string;
  title: string;
  cost: number;
  retries: number;
}

interface CostsResponse {
  total: number;
  budgetLimit: number | null;
  budgetRemaining: number | null;
  nodes: CostNode[];
  loomCost: number;
}

interface NodeEntry {
  id: string;
  title: string;
  status: string;
  agentCount: number;
  cost: number;
  retryCount: number;
}

// ============================================================================
// Helpers
// ============================================================================

const STATUS_ORDER: readonly string[] = [
  "running",
  "review",
  "pending",
  "waiting",
  "blocked",
  "done",
  "failed",
];

function toneForStatus(status: string): Parameters<typeof theme.line>[1] {
  switch (status) {
    case "running":
      return "accent";
    case "done":
      return "muted";
    case "failed":
      return "err";
    case "blocked":
      return "warn";
    case "review":
      return "muted";
    default:
      return "dim";
  }
}

function colorizeStatus(text: string, status: string): string {
  const tone = toneForStatus(status);
  return theme[tone](text);
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

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

export function createStatusCommand(): Command {
  const cmd = new Command("status")
    .description("Show workflow status and costs")
    .action(async (options: { json?: boolean }): Promise<void> => {
      const json = isJsonMode(options);

      let projectId: string;
      try {
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        projectId = identity.id;
      } catch (err) {
        writeError(options, (err as Error).message, "E_PROJECT");
        process.exitCode = 1;
        return;
      }

      let client: Awaited<ReturnType<typeof openClient>>;
      try {
        client = await openClient(projectId);
      } catch (err) {
        writeError(options, (err as Error).message, "E_DAEMON");
        process.exitCode = 1;
        return;
      }

      const [workflowResult, costsResult, nodesResult] = await Promise.allSettled([
        client.request<WorkflowResponse>("GET", "/workflow"),
        client.request<CostsResponse>("GET", "/costs"),
        client.request<NodeEntry[]>("GET", "/nodes"),
      ]);

      if (workflowResult.status === "rejected") {
        const msg = (workflowResult.reason as Error).message;
        if (msg.includes("HTTP 404")) {
          if (json) {
            writeJson({ workflow: null });
          } else {
            process.stdout.write(
              `${theme.line(theme.glyph.arrow, "dim", "No active workflow. Start one with: loomflo start")}\n`,
            );
          }
          return;
        }
        writeError(options, "Failed to connect to daemon.", "E_CONNECT");
        process.exitCode = 1;
        return;
      }

      const workflow = workflowResult.value;
      let nodes: NodeEntry[] = [];
      if (nodesResult.status === "fulfilled") {
        nodes = nodesResult.value;
      }

      if (json) {
        const costs = costsResult.status === "fulfilled" ? costsResult.value : null;
        writeJson({
          workflow: { id: workflow.id, status: workflow.status, description: workflow.description },
          nodes: nodes.map((n) => ({ id: n.id, title: n.title, status: n.status, cost: n.cost })),
          cost: costs !== null ? { total: costs.total, budgetLimit: costs.budgetLimit, budgetRemaining: costs.budgetRemaining, loomCost: costs.loomCost } : null,
        });
        return;
      }

      // --- Themed output ---

      process.stdout.write(`${theme.heading("Workflow")}\n`);
      process.stdout.write(`${theme.kv("id", workflow.id, 12)}\n`);
      process.stdout.write(`${theme.kv("status", colorizeStatus(workflow.status, workflow.status), 12)}\n`);
      process.stdout.write(`${theme.kv("desc", workflow.description, 12)}\n`);
      process.stdout.write(`${theme.kv("elapsed", formatElapsed(workflow.createdAt), 12)}\n`);
      process.stdout.write("\n");

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
        const summaryParts = sortedStatuses.map(
          ([status, count]) => `${colorizeStatus(status, status)}: ${String(count)}`,
        );
        process.stdout.write(`${theme.heading("Nodes Summary")}\n`);
        process.stdout.write(`${theme.kv("total", String(nodes.length))}\n`);
        process.stdout.write(`  ${summaryParts.join("  ")}\n`);
        process.stdout.write("\n");
      }

      const activeNodes = nodes.filter((n) => n.status === "running" || n.status === "review");
      if (activeNodes.length > 0) {
        process.stdout.write(`${theme.heading("Active Nodes")}\n`);
        for (const node of activeNodes) {
          process.stdout.write(
            `${theme.line(theme.glyph.dot, toneForStatus(node.status), node.title, `${colorizeStatus(node.status, node.status)} \u00B7 ${String(node.agentCount)} agents`)}\n`,
          );
        }
        process.stdout.write("\n");
      }

      if (nodes.length > 0) {
        process.stdout.write(`${theme.heading("Node Costs")}\n`);
        process.stdout.write(
          theme.table(
            ["Node", "Status", "Cost", "Retries"],
            nodes,
            [
              { header: "Node", get: (r) => r.title },
              { header: "Status", get: (r) => colorizeStatus(r.status, r.status) },
              { header: "Cost", get: (r) => formatCost(r.cost), align: "right" },
              { header: "Retries", get: (r) => String(r.retryCount) },
            ],
          ) + "\n",
        );
        process.stdout.write("\n");
      }

      if (costsResult.status === "fulfilled") {
        const costs = costsResult.value;
        process.stdout.write(`${theme.heading("Cost Summary")}\n`);
        process.stdout.write(`${theme.kv("total", formatCost(costs.total), 12)}\n`);
        process.stdout.write(`${theme.kv("budget", costs.budgetLimit !== null ? formatCost(costs.budgetLimit) : "None", 12)}\n`);
        process.stdout.write(`${theme.kv("remaining", costs.budgetRemaining !== null ? formatCost(costs.budgetRemaining) : "N/A", 12)}\n`);
        process.stdout.write(`${theme.kv("overhead", formatCost(costs.loomCost), 12)}\n`);
      }
    });

  return withJsonSupport(cmd);
}
