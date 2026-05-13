/**
 * `loomflo inspect <nodeId>` — per-node detail view.
 *
 * Shows detailed information for a single node including status, agents,
 * file ownership, retry info, cost, and optional review report.
 *
 * @module
 */

import { Command } from "commander";

import { readDaemonConfig } from "../client.js";
import { httpGet, type DaemonEndpoint } from "../observation/api.js";
import { withJsonSupport, isJsonMode, writeJson, writeError, type WithJsonOption } from "../output.js";
import { resolveProject } from "../project-resolver.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Types
// ============================================================================

/** Detailed shape of a single node returned by the daemon API. */
interface NodeDetail {
  id: string;
  title: string;
  status: string;
  agents: Array<{ id: string; role: string; status: string; tokens: number }>;
  fileOwnership: string[];
  retryCount: number;
  maxRetries: number;
  reviewReport: unknown;
  cost: number;
  startedAt: string | null;
  completedAt: string | null;
}

/** CLI options for the inspect command. */
interface InspectOptions extends WithJsonOption {
  project?: string;
}

// ============================================================================
// Render helpers
// ============================================================================

/**
 * Render a multi-section detail view for a node.
 *
 * @param detail - The node detail object from the daemon.
 * @returns Formatted string for human-readable output.
 */
function renderDetail(detail: NodeDetail): string {
  const lines: string[] = [];

  // Header
  lines.push(theme.heading(`${detail.id}  —  ${detail.title}`));
  lines.push("");

  // Key-value fields
  const kvWidth = 13;
  lines.push(theme.kv("status", detail.status, kvWidth));
  lines.push(theme.kv("retries", `${String(detail.retryCount)}/${String(detail.maxRetries)}`, kvWidth));
  lines.push(theme.kv("cost", `$${detail.cost.toFixed(2)}`, kvWidth));
  lines.push(theme.kv("startedAt", detail.startedAt ?? "—", kvWidth));
  lines.push(theme.kv("completedAt", detail.completedAt ?? "—", kvWidth));
  lines.push("");

  // Agents section
  lines.push(theme.muted("Agents"));
  for (const agent of detail.agents) {
    const role = theme.accent(agent.role);
    const id = theme.dim(agent.id);
    const tokens = theme.dim(`${String(agent.tokens)} tok`);
    lines.push(`  ${role}  ${id}  ${agent.status}  ${tokens}`);
  }
  lines.push("");

  // Files section
  lines.push(theme.muted("Files"));
  for (const file of detail.fileOwnership) {
    lines.push(`  ${file}`);
  }

  // Review section (only if report exists)
  if (detail.reviewReport != null) {
    lines.push("");
    lines.push(theme.muted("Review"));
    lines.push(`  ${JSON.stringify(detail.reviewReport, null, 2)}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `inspect` command for the loomflo CLI.
 *
 * Usage:
 *   `loomflo inspect <nodeId>`              — show detail for a node
 *   `loomflo inspect <nodeId> --project <id>` — target a specific project
 *   `loomflo inspect <nodeId> --json`       — emit the raw detail as JSON
 *
 * @returns A configured commander Command instance.
 */
export function createInspectCommand(): Command {
  const cmd = new Command("inspect")
    .description("Show detailed information for a node")
    .argument("<nodeId>", "Node ID to inspect")
    .option("--project <id>", "Override cwd resolution with a specific project ID")
    .action(async (nodeId: string, opts: InspectOptions): Promise<void> => {
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

        // Fetch node detail from the daemon
        const detail = await httpGet<NodeDetail>(
          `/projects/${projectId}/nodes/${nodeId}`,
          daemon as DaemonEndpoint,
        );

        // JSON output
        if (isJsonMode(opts)) {
          writeJson(detail);
          return;
        }

        // Human-readable output
        process.stdout.write(`${renderDetail(detail)}\n`);
      } catch (err) {
        writeError(opts, (err as Error).message, "E_INSPECT");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
