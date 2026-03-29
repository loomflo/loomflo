import { Command } from 'commander';

import { DaemonClient, readDaemonConfig } from '../client.js';

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

/** Shape of an API error response. */
interface ErrorResponse {
  error: string;
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
  return date.toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Format a single event as a human-readable log line.
 *
 * @param event - The event to format.
 * @returns A formatted string suitable for console output.
 */
function formatEvent(event: Event): string {
  const time = formatTimestamp(event.ts);
  const node = event.nodeId !== null ? ` [${event.nodeId}]` : '';
  const agent = event.agentId !== null ? ` agent=${event.agentId}` : '';

  const detailKeys = Object.keys(event.details);
  const detail = detailKeys.length > 0
    ? ' ' + JSON.stringify(event.details)
    : '';

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
 *   `loomflo logs -f` — stream events in real time via WebSocket
 *
 * @returns A configured commander Command instance.
 */
export function createLogsCommand(): Command {
  const cmd = new Command('logs')
    .description('Fetch and display agent logs')
    .argument('[node-id]', 'Filter events by node ID')
    .option('--type <type>', 'Filter by event type')
    .option('--limit <n>', 'Maximum number of events to fetch', '50')
    .option('-f, --follow', 'Stream new events in real time via WebSocket', false)
    .action(async (nodeId: string | undefined, opts: LogsOptions): Promise<void> => {
      /* ------------------------------------------------------------------ */
      /* Connect to daemon                                                  */
      /* ------------------------------------------------------------------ */

      let config;
      try {
        config = await readDaemonConfig();
      } catch {
        console.error('Daemon is not running. Start with: loomflo start');
        process.exit(1);
      }

      const client = new DaemonClient(config.port, config.token);

      /* ------------------------------------------------------------------ */
      /* Build query string                                                 */
      /* ------------------------------------------------------------------ */

      const params = new URLSearchParams();

      if (nodeId !== undefined) {
        params.set('nodeId', nodeId);
      }
      if (opts.type !== undefined) {
        params.set('type', opts.type);
      }

      const limit = parseInt(opts.limit, 10);
      params.set('limit', String(Number.isFinite(limit) && limit > 0 ? limit : 50));

      const queryString = params.toString();
      const path = queryString.length > 0 ? `/events?${queryString}` : '/events';

      /* ------------------------------------------------------------------ */
      /* Fetch historical events                                            */
      /* ------------------------------------------------------------------ */

      const result = await client.get<EventsResponse | ErrorResponse>(path);

      if (!result.ok) {
        const errorData = result.data as ErrorResponse;
        console.error(`Failed to fetch events: ${errorData.error}`);
        process.exit(1);
      }

      const { events, total } = result.data as EventsResponse;

      if (events.length === 0 && !opts.follow) {
        console.log('No events found.');
        return;
      }

      /* Print events in chronological order (API returns most recent first). */
      const chronological = [...events].reverse();
      for (const event of chronological) {
        console.log(formatEvent(event));
      }

      if (events.length < total) {
        console.log(`\nShowing ${String(events.length)} of ${String(total)} events. Use --limit to see more.`);
      }

      /* ------------------------------------------------------------------ */
      /* Follow mode: stream live events via WebSocket                      */
      /* ------------------------------------------------------------------ */

      if (!opts.follow) {
        return;
      }

      console.log('\n--- streaming live events (Ctrl+C to stop) ---\n');

      client.connectWebSocket();

      /** Handle an incoming WebSocket event and print it if it matches filters. */
      const handleWsEvent = (wsEvent: Record<string, unknown>): void => {
        const event: Event = {
          ts: typeof wsEvent['timestamp'] === 'string'
            ? wsEvent['timestamp']
            : new Date().toISOString(),
          type: String(wsEvent['type'] ?? 'unknown'),
          nodeId: typeof wsEvent['nodeId'] === 'string' ? wsEvent['nodeId'] : null,
          agentId: typeof wsEvent['agentId'] === 'string' ? wsEvent['agentId'] : null,
          details: {},
        };

        /* Apply the same filters as the historical query. */
        if (nodeId !== undefined && event.nodeId !== nodeId) {
          return;
        }
        if (opts.type !== undefined && event.type !== opts.type) {
          return;
        }

        console.log(formatEvent(event));
      };

      /* Subscribe to all relevant event types via a catch-all approach:
         the DaemonClient dispatches by `type` field, so we listen on common types. */
      const eventTypes = [
        'node_status',
        'agent_status',
        'agent_message',
        'review_verdict',
        'graph_modified',
        'cost_update',
        'memory_updated',
        'workflow_status',
      ] as const;

      const removers: Array<() => void> = [];
      for (const eventType of eventTypes) {
        const remover = client.on(eventType, (payload) => {
          handleWsEvent(payload as unknown as Record<string, unknown>);
        });
        removers.push(remover);
      }

      /* Keep the process alive until interrupted. */
      const cleanup = (): void => {
        for (const remove of removers) {
          remove();
        }
        client.disconnect();
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      /* Prevent Node from exiting while streaming. */
      await new Promise<never>(() => {
        /* Intentionally never resolves — process exits via signal handler. */
      });
    });

  return cmd;
}
