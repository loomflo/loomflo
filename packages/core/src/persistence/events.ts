import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventSchema } from '../types.js';
import type { Event, EventType } from '../types.js';

// ============================================================================
// Types
// ============================================================================

/** Filters for querying events from the event log. */
export interface EventQueryFilters {
  /** Filter by one or more event types. */
  type?: EventType | EventType[];
  /** Filter by node ID. */
  nodeId?: string;
  /** Filter by agent ID. */
  agentId?: string;
  /** ISO 8601 timestamp — include events at or after this time. */
  after?: string;
  /** ISO 8601 timestamp — exclude events at or after this time. */
  before?: string;
  /** Maximum number of results, taken from the end of the log. */
  limit?: number;
}

/** Parameters for creating a new event via the factory function. */
export interface CreateEventParams {
  /** Event type identifier. */
  type: EventType;
  /** Workflow this event belongs to. */
  workflowId: string;
  /** Node this event relates to, or null/undefined for workflow-level events. */
  nodeId?: string | null;
  /** Agent this event relates to, or null/undefined for node/workflow-level events. */
  agentId?: string | null;
  /** Event-specific payload data. */
  details?: Record<string, unknown>;
}

// ============================================================================
// Constants
// ============================================================================

const LOOMFLO_DIR = '.loomflo';
const EVENTS_FILE = 'events.jsonl';

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a valid Event object with the current timestamp.
 *
 * @param params - Event creation parameters.
 * @returns A fully populated Event object ready for persistence.
 */
export function createEvent(params: CreateEventParams): Event {
  return {
    ts: new Date().toISOString(),
    type: params.type,
    workflowId: params.workflowId,
    nodeId: params.nodeId ?? null,
    agentId: params.agentId ?? null,
    details: params.details ?? {},
  };
}

/**
 * Append a single event as one JSON line to the project's events.jsonl file.
 *
 * Creates the .loomflo/ directory and events.jsonl file if they do not exist.
 * Uses append mode so concurrent writes each produce a complete line.
 *
 * @param projectPath - Absolute path to the project workspace.
 * @param event - The event to persist.
 */
export async function appendEvent(projectPath: string, event: Event): Promise<void> {
  const dir = join(projectPath, LOOMFLO_DIR);
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, EVENTS_FILE);
  const line = JSON.stringify(event) + '\n';
  await appendFile(filePath, line, { encoding: 'utf-8' });
}

/**
 * Read and filter events from the project's events.jsonl file.
 *
 * Parses each line independently, validates against EventSchema, and applies
 * optional filters. Malformed lines are skipped with a warning logged to stderr.
 *
 * @param projectPath - Absolute path to the project workspace.
 * @param filters - Optional filters to narrow the result set.
 * @returns Array of matching Event objects in log order.
 */
export async function queryEvents(
  projectPath: string,
  filters?: EventQueryFilters,
): Promise<Event[]> {
  const filePath = join(projectPath, LOOMFLO_DIR, EVENTS_FILE);

  let raw: string;
  try {
    raw = await readFile(filePath, { encoding: 'utf-8' });
  } catch {
    // File does not exist yet — no events to return.
    return [];
  }

  const lines = raw.split('\n');
  let events: Event[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn(`events.jsonl line ${i + 1}: invalid JSON, skipping`);
      continue;
    }

    const result = EventSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`events.jsonl line ${i + 1}: schema validation failed, skipping`);
      continue;
    }

    events.push(result.data);
  }

  if (filters) {
    events = applyFilters(events, filters);
  }

  return events;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Apply query filters to an array of events.
 *
 * @param events - Unfiltered events in log order.
 * @param filters - Filters to apply.
 * @returns Filtered events.
 */
function applyFilters(events: Event[], filters: EventQueryFilters): Event[] {
  let result = events;

  if (filters.type !== undefined) {
    const types: Set<EventType> = new Set(
      Array.isArray(filters.type) ? filters.type : [filters.type],
    );
    result = result.filter((e) => types.has(e.type));
  }

  if (filters.nodeId !== undefined) {
    result = result.filter((e) => e.nodeId === filters.nodeId);
  }

  if (filters.agentId !== undefined) {
    result = result.filter((e) => e.agentId === filters.agentId);
  }

  if (filters.after !== undefined) {
    const after = filters.after;
    result = result.filter((e) => e.ts >= after);
  }

  if (filters.before !== undefined) {
    const before = filters.before;
    result = result.filter((e) => e.ts < before);
  }

  if (filters.limit !== undefined && filters.limit > 0) {
    result = result.slice(-filters.limit);
  }

  return result;
}
