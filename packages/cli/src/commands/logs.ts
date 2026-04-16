import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { readDaemonConfig } from "../client.js";
import { openClient } from "../client.js";
import { withJsonSupport, isJsonMode, writeJsonStream, writeError } from "../output.js";
import { openSubscription } from "../observation/ws.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Types
// ============================================================================

/** A single event entry returned by GET /events. */
interface Event {
  ts: string;
  type: string;
  nodeId: string | null;
  agentId: string | null;
  details: Record<string, unknown>;
}

/** Shape of the GET /events success response. */
interface EventsResponse {
  events: Event[];
  total: number;
}

/** Parsed CLI options for the logs command. */
interface LogsOptions {
  type?: string;
  limit: string;
  follow: boolean;
  json?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a timestamp string into a compact local time representation.
 *
 * @param ts - An ISO 8601 timestamp string.
 * @returns A human-readable local time string (HH:MM:SS).
 */
function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", { hour12: false });
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `logs` command for the loomflo CLI.
 *
 * Usage:
 *   `loomflo logs` — show all recent events (most recent first)
 *   `loomflo logs <node-id>` — show events for a specific node
 *   `loomflo logs --type agent_created` — filter by event type
 *   `loomflo logs --limit 100` — fetch more events
 *   `loomflo logs -f` — stream live events via WebSocket
 *
 * @returns A configured commander Command instance.
 */
export function createLogsCommand(): Command {
  const cmd = new Command("logs")
    .description("Fetch and display agent logs")
    .argument("[node-id]", "Filter events by node ID")
    .option("--type <type>", "Filter by event type")
    .option("--limit <n>", "Maximum number of events to fetch", "50")
    .option("-f, --follow", "Stream new events in real time via WebSocket", false)
    .action(async (nodeId: string | undefined, opts: LogsOptions): Promise<void> => {
      try {
        /* ---------------------------------------------------------------- */
        /* Follow-only mode: WS subscription (works outside a project)     */
        /* ---------------------------------------------------------------- */

        if (opts.follow) {
          const daemon = await readDaemonConfig();

          // Resolve project if possible; if outside a project, subscribe to all.
          let projectId: string | undefined;
          try {
            const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
            projectId = identity.id;
          } catch {
            // Not inside a project — subscribe to all
          }

          const sub = await openSubscription(
            daemon,
            projectId !== undefined ? { projectIds: [projectId] } : { all: true },
          );

          const cleanup = (): void => {
            sub.close();
            process.exit(0);
          };
          process.on("SIGINT", cleanup);
          process.on("SIGTERM", cleanup);

          sub.onMessage((frame) => {
            const f = frame as Record<string, unknown>;

            // Filter by nodeId if positional arg was passed
            if (nodeId !== undefined) {
              const frameNodeId = typeof f["nodeId"] === "string" ? f["nodeId"] : undefined;
              if (frameNodeId !== nodeId) return;
            }

            // Filter by --type if flag was passed
            if (opts.type !== undefined) {
              const frameType = typeof f["type"] === "string" ? f["type"] : undefined;
              if (frameType !== opts.type) return;
            }

            if (isJsonMode(opts)) {
              process.stdout.write(`${JSON.stringify(f)}\n`);
              return;
            }
            const type = typeof f["type"] === "string" ? f["type"] : "event";
            const ts = typeof f["timestamp"] === "string" ? formatTimestamp(f["timestamp"]) : "";
            const evNodeId = typeof f["nodeId"] === "string" ? f["nodeId"] : undefined;
            process.stdout.write(
              `${theme.line(theme.glyph.arrow, "muted", `${type}  ${theme.dim(ts)}`, evNodeId)}\n`,
            );
          });

          await new Promise<void>((resolve) => { sub.onClose(() => { resolve(); }); });
          return;
        }

        /* ---------------------------------------------------------------- */
        /* Historical mode: REST fetch (requires a project)                */
        /* ---------------------------------------------------------------- */

        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        const client = await openClient(identity.id);

        const params = new URLSearchParams();

        if (nodeId !== undefined) {
          params.set("nodeId", nodeId);
        }
        if (opts.type !== undefined) {
          params.set("type", opts.type);
        }

        const limit = parseInt(opts.limit, 10);
        params.set("limit", String(Number.isFinite(limit) && limit > 0 ? limit : 50));

        const queryString = params.toString();
        const path = queryString.length > 0 ? `/events?${queryString}` : "/events";

        const { events, total } = await client.request<EventsResponse>("GET", path);

        /* Print events in chronological order (API returns most recent first). */
        const chronological = [...events].reverse();

        if (isJsonMode(opts)) {
          writeJsonStream(chronological);
          return;
        }

        if (events.length === 0) {
          process.stdout.write(
            `${theme.line(theme.glyph.arrow, "dim", "No events found.")}\n`,
          );
          return;
        }

        for (const event of chronological) {
          process.stdout.write(
            `${theme.line(theme.glyph.arrow, "muted", `${event.type}  ${theme.dim(formatTimestamp(event.ts))}`, event.nodeId ?? undefined)}\n`,
          );
        }

        if (events.length < total) {
          process.stdout.write(
            `${theme.line(theme.glyph.arrow, "dim", `Showing ${String(events.length)} of ${String(total)}. Use --limit to see more.`)}\n`,
          );
        }
      } catch (err) {
        writeError(opts, (err as Error).message, "E_LOGS");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
