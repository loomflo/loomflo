/**
 * `loomflo ps` — cross-project runtime table.
 *
 * Lists all registered projects with their current runtime state in
 * a colour-coded table. Supports `--json` for machine-readable output.
 *
 * @module
 */

import { Command } from "commander";

import { readDaemonConfig } from "../client.js";
import { fetchProjectsRuntime, type ProjectRuntimeRow } from "../observation/api.js";
import { withJsonSupport, isJsonMode, writeJson, writeError, type WithJsonOption } from "../output.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Helpers (exported — reused by T3/T6)
// ============================================================================

/**
 * Render a themed status cell for a project runtime status string.
 *
 * @param status - The runtime status (e.g. "running", "idle", "blocked").
 * @returns A colour-coded string suitable for table display.
 */
export function statusCell(status: string): string {
  switch (status) {
    case "running":
      return `${theme.accent(theme.glyph.dot)} running`;
    case "blocked":
    case "failed":
      return `${theme.err(theme.glyph.dot)} ${status}`;
    case "completed":
      return `${theme.accent("✓")} completed`;
    case "unknown":
      return `${theme.warn(theme.glyph.dot)} unknown`;
    default:
      return `${theme.dim(theme.glyph.dot)} ${status}`;
  }
}

/**
 * Format an uptime duration in seconds into a compact human-readable string.
 *
 * @param s - Uptime in seconds (0 means not started).
 * @returns Formatted string like "—", "42s", "2m 14s", or "1h 23m".
 */
export function formatUptime(s: number): string {
  if (s === 0) return "—";

  const totalSec = Math.floor(s);

  if (totalSec < 60) return `${String(totalSec)}s`;

  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;

  if (totalSec < 3600) {
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours)}h ${String(remainingMinutes)}m`;
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `ps` command for the loomflo CLI.
 *
 * Usage:
 *   `loomflo ps`        — display a table of all projects with runtime state
 *   `loomflo ps --json` — emit the full runtime array as JSON
 *
 * @returns A configured commander Command instance.
 */
export function createPsCommand(): Command {
  const cmd = new Command("ps")
    .description("List all registered projects with runtime state")
    .action(async (opts: WithJsonOption): Promise<void> => {
      try {
        const daemon = await readDaemonConfig();
        const rows = await fetchProjectsRuntime(daemon);

        if (isJsonMode(opts)) {
          writeJson(rows);
          return;
        }

        if (rows.length === 0) {
          process.stdout.write(
            `${theme.line(theme.glyph.arrow, "dim", "No projects registered.")}\n`,
          );
          return;
        }

        const output = theme.table<ProjectRuntimeRow>(
          ["PROJECT", "ID", "STATUS", "NODE", "UPTIME", "COST"],
          rows,
          [
            { header: "PROJECT", get: (r) => r.name },
            { header: "ID", get: (r) => theme.dim(r.id) },
            { header: "STATUS", get: (r) => statusCell(r.status) },
            { header: "NODE", get: (r) => r.currentNodeId ?? theme.dim("—") },
            { header: "UPTIME", get: (r) => formatUptime(r.uptimeSec), align: "right" },
            { header: "COST", get: (r) => `$${r.cost.toFixed(2)}`, align: "right" },
          ],
        );

        process.stdout.write(`${output}\n`);
      } catch (err) {
        writeError(opts, (err as Error).message, "E_PS");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
