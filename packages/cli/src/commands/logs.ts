import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";

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

/**
 * Format a single event as a human-readable log line.
 *
 * @param event - The event to format.
 * @returns A formatted string suitable for console output.
 */
function formatEvent(event: Event): string {
  const time = formatTimestamp(event.ts);
  const node = event.nodeId !== null ? ` [${event.nodeId}]` : "";
  const agent = event.agentId !== null ? ` agent=${event.agentId}` : "";

  const detailKeys = Object.keys(event.details);
  const detail = detailKeys.length > 0 ? " " + JSON.stringify(event.details) : "";

  return `${time}${node} ${event.type}${agent}${detail}`;
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
  return new Command("logs")
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

        if (events.length === 0 && !opts.follow) {
          console.log("No events found.");
          return;
        }

        /* Print events in chronological order (API returns most recent first). */
        const chronological = [...events].reverse();
        for (const event of chronological) {
          console.log(formatEvent(event));
        }

        if (events.length < total) {
          console.log(
            `\nShowing ${String(events.length)} of ${String(total)} events. Use --limit to see more.`,
          );
        }

        /* ---------------------------------------------------------------- */
        /* Follow mode: temporarily disabled                                */
        /* TODO(S3/S4): wire up multiplexed WebSocket subscribe protocol   */
        /* ---------------------------------------------------------------- */

        if (opts.follow) {
          console.warn(
            "--follow is temporarily disabled pending WebSocket multiplexing (S3/S4)",
          );
          return;
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
