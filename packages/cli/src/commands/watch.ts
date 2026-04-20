/**
 * `loomflo watch [projectId]` — live multi-project view via WebSocket.
 *
 * Opens a WS subscription to the daemon and periodically re-fetches
 * project runtime data, rendering a refreshing table to stdout. The
 * WS push notifications trigger a dirty flag so the next tick re-renders.
 *
 * @module
 */

import { Command } from "commander";

import { readDaemonConfig } from "../client.js";
import { fetchProjectsRuntime, type ProjectRuntimeRow } from "../observation/api.js";
import { openSubscription, type Subscription, type SubscribeSpec } from "../observation/ws.js";
import { withJsonSupport, isJsonMode, writeJson, writeError, type WithJsonOption } from "../output.js";
import { statusCell, formatUptime } from "./ps.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Types
// ============================================================================

interface WatchOptions extends WithJsonOption {
  interval?: string;
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render the watch frame: header + project table or JSON array.
 *
 * @param rows - Current project runtime rows.
 * @param opts - Command options (for JSON mode detection).
 */
function renderFrame(rows: ProjectRuntimeRow[], opts: WatchOptions): void {
  if (isJsonMode(opts)) {
    writeJson(rows);
    return;
  }

  // Clear screen (ANSI escape: move cursor home + clear)
  process.stdout.write("\x1B[H\x1B[2J");

  const header = theme.heading("loomflo watch");
  process.stdout.write(`${header}\n\n`);

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
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `watch` command for the loomflo CLI.
 *
 * Usage:
 *   `loomflo watch`              — live view of all projects
 *   `loomflo watch <projectId>`  — live view of a single project
 *   `loomflo watch -n 5`         — refresh every 5 seconds
 *   `loomflo watch --json`       — emit JSON on each tick
 *
 * @returns A configured commander Command instance.
 */
export function createWatchCommand(): Command {
  const cmd = new Command("watch")
    .description("Live auto-refreshing runtime view via WebSocket")
    .argument("[projectId]", "Optional project ID to filter")
    .option("-n, --interval <seconds>", "Refresh interval in seconds", "2")
    .action(async (projectId: string | undefined, opts: WatchOptions): Promise<void> => {
      try {
        // Parse interval (min 1 second, default 2)
        const raw = Number(opts.interval ?? "2");
        const intervalSec = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 2;

        // Read daemon connection info
        const daemon = await readDaemonConfig();

        // Initial fetch
        let rows = await fetchProjectsRuntime(daemon);
        if (projectId !== undefined) {
          rows = rows.filter((r) => r.id === projectId);
        }

        // Open WS subscription
        const spec: SubscribeSpec = projectId !== undefined
          ? { projectIds: [projectId] }
          : { all: true };
        const sub: Subscription = await openSubscription(daemon, spec);

        // Dirty flag — set by WS messages, consumed by interval timer
        let dirty = false;

        sub.onMessage(() => {
          dirty = true;
        });

        // Initial paint
        renderFrame(rows, opts);

        // Interval timer — re-fetches and re-renders when dirty or on tick
        const tick = (): void => {
          if (!dirty) return;
          dirty = false;
          fetchProjectsRuntime(daemon)
            .then((freshRows) => {
              if (projectId !== undefined) {
                rows = freshRows.filter((r) => r.id === projectId);
              } else {
                rows = freshRows;
              }
              renderFrame(rows, opts);
            })
            .catch(() => {
              // Swallow fetch errors on tick — next tick will retry
            });
        };
        const timer = setInterval(tick, intervalSec * 1000);

        // Cleanup on SIGINT / SIGTERM
        const cleanup = (): void => {
          clearInterval(timer);
          sub.close();
          process.exit(0);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        // Keep the process alive — the interval and WS keep the event loop running.
        // The command resolves only when cleanup fires.
        await new Promise<void>(() => {
          // never resolves — process exits via cleanup
        });
      } catch (err) {
        writeError(opts, (err as Error).message, "E_WATCH");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
