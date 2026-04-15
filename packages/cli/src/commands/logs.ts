import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";
import { withJsonSupport, isJsonMode, writeJsonStream, writeError } from "../output.js";
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
 *   `loomflo logs -f` — (temporarily disabled, see note below)
 *
 * Note: --follow is temporarily disabled pending WebSocket multiplexing
 * (S3/S4). When enabled, it will stream live events via the multiplexed
 * WS endpoint with a subscribe protocol.
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
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        const client = await openClient(identity.id);

        /* ---------------------------------------------------------------- */
        /* Build query string                                               */
        /* ---------------------------------------------------------------- */

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

        /* ---------------------------------------------------------------- */
        /* Fetch historical events                                          */
        /* ---------------------------------------------------------------- */

        const { events, total } = await client.request<EventsResponse>("GET", path);

        /* Print events in chronological order (API returns most recent first). */
        const chronological = [...events].reverse();

        if (isJsonMode(opts)) {
          writeJsonStream(chronological);
          return;
        }

        if (events.length === 0 && !opts.follow) {
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

        /* ---------------------------------------------------------------- */
        /* Follow mode: temporarily disabled                                */
        /* TODO(S3/S4): wire up multiplexed WebSocket subscribe protocol   */
        /* ---------------------------------------------------------------- */

        if (opts.follow) {
          process.stderr.write(
            `${theme.line(theme.glyph.warn, "warn", "--follow is temporarily disabled pending WebSocket multiplexing")}\n`,
          );
          return;
        }
      } catch (err) {
        writeError(opts, (err as Error).message, "E_LOGS");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
