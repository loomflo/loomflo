// ============================================================================
// LogStream Component
//
// Real-time scrollable log viewer for workflow events. Supports agent and
// event-type filtering, auto-scroll (paused when the user scrolls up),
// color-coded event types, and monospace formatting. Designed for the
// dark-themed dashboard.
// ============================================================================

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import type { Event, EventType } from "../lib/types.js";

// ============================================================================
// Types
// ============================================================================

/** Props for the {@link LogStream} component. */
export interface LogStreamProps {
  /** Ordered array of workflow events to display. */
  events: Event[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Pixel threshold from the bottom of the scroll container within which
 * auto-scroll remains active.
 */
const AUTO_SCROLL_THRESHOLD = 40;

/** Maximum character length for the displayed event details summary. */
const DETAILS_MAX_LENGTH = 100;

/** Color classes keyed by event type for the log entry badge. */
const EVENT_TYPE_STYLES: Record<EventType, { bg: string; text: string }> = {
  // Workflow lifecycle — gray
  workflow_created: { bg: "bg-gray-700", text: "text-gray-300" },
  workflow_started: { bg: "bg-blue-900", text: "text-blue-300" },
  workflow_paused: { bg: "bg-amber-900", text: "text-amber-300" },
  workflow_resumed: { bg: "bg-blue-900", text: "text-blue-300" },
  workflow_completed: { bg: "bg-green-900", text: "text-green-300" },

  // Spec phase — purple
  spec_phase_started: { bg: "bg-purple-900", text: "text-purple-300" },
  spec_phase_completed: { bg: "bg-purple-900", text: "text-purple-300" },

  // Graph — cyan
  graph_built: { bg: "bg-cyan-900", text: "text-cyan-300" },
  graph_modified: { bg: "bg-cyan-900", text: "text-cyan-300" },

  // Node lifecycle — blue / green / red / orange
  node_started: { bg: "bg-blue-900", text: "text-blue-300" },
  node_completed: { bg: "bg-green-900", text: "text-green-300" },
  node_failed: { bg: "bg-red-900", text: "text-red-300" },
  node_blocked: { bg: "bg-orange-900", text: "text-orange-300" },

  // Agent lifecycle — blue / green / red
  agent_created: { bg: "bg-gray-700", text: "text-gray-300" },
  agent_completed: { bg: "bg-green-900", text: "text-green-300" },
  agent_failed: { bg: "bg-red-900", text: "text-red-300" },

  // Review — purple
  reviewer_started: { bg: "bg-purple-900", text: "text-purple-300" },
  reviewer_verdict: { bg: "bg-purple-900", text: "text-purple-300" },

  // Retry & escalation — amber / red
  retry_triggered: { bg: "bg-amber-900", text: "text-amber-300" },
  escalation_triggered: { bg: "bg-red-900", text: "text-red-300" },

  // Misc — gray / teal
  message_sent: { bg: "bg-gray-700", text: "text-gray-300" },
  cost_tracked: { bg: "bg-teal-900", text: "text-teal-300" },
  memory_updated: { bg: "bg-teal-900", text: "text-teal-300" },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format an ISO 8601 timestamp as `HH:MM:SS.mmm`.
 *
 * @param iso - ISO 8601 timestamp string.
 * @returns Formatted time string.
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Produce a single-line summary from an event's details payload.
 *
 * Serializes the record to JSON, strips braces, and truncates.
 *
 * @param details - Event-specific payload data.
 * @returns Human-readable summary string, or an empty string.
 */
function summarizeDetails(details: Record<string, unknown>): string {
  const keys = Object.keys(details);
  if (keys.length === 0) {
    return "";
  }
  const raw = JSON.stringify(details);
  // Strip outer braces for a cleaner inline display.
  const inner = raw.slice(1, -1);
  if (inner.length <= DETAILS_MAX_LENGTH) {
    return inner;
  }
  return `${inner.slice(0, DETAILS_MAX_LENGTH)}…`;
}

/**
 * Extract unique non-null agent IDs from an event array.
 *
 * @param events - Source event array.
 * @returns Sorted array of unique agent IDs.
 */
function extractAgentIds(events: Event[]): string[] {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.agentId !== null) {
      ids.add(e.agentId);
    }
  }
  return Array.from(ids).sort();
}

/**
 * Extract unique event types present in an event array.
 *
 * @param events - Source event array.
 * @returns Sorted array of unique event types.
 */
function extractEventTypes(events: Event[]): EventType[] {
  const types = new Set<EventType>();
  for (const e of events) {
    types.add(e.type);
  }
  return Array.from(types).sort();
}

// ============================================================================
// LogStream Component
// ============================================================================

/**
 * Real-time scrollable log viewer for workflow events.
 *
 * Displays events as monospace log entries with timestamps, color-coded
 * event-type badges, node/agent context, and a details summary. Supports
 * filtering by agent ID and event type. Auto-scrolls to the newest entry
 * unless the user has scrolled upward.
 *
 * @param props - Event data.
 * @returns Rendered log stream element.
 */
export const LogStream = memo(function LogStream({ events }: LogStreamProps): ReactElement {
  // ---- State ----
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<EventType | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // ---- Refs ----
  const containerRef = useRef<HTMLDivElement>(null);

  // ---- Derived data ----
  const agentIds = useMemo(() => extractAgentIds(events), [events]);
  const eventTypes = useMemo(() => extractEventTypes(events), [events]);

  const filteredEvents = useMemo((): Event[] => {
    return events.filter((e) => {
      if (selectedAgent !== null && e.agentId !== selectedAgent) {
        return false;
      }
      if (selectedType !== null && e.type !== selectedType) {
        return false;
      }
      return true;
    });
  }, [events, selectedAgent, selectedType]);

  // ---- Auto-scroll effect ----
  useEffect(() => {
    const el = containerRef.current;
    if (autoScroll && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filteredEvents, autoScroll]);

  // ---- Handlers ----
  const handleScroll = useCallback((): void => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD;
    setAutoScroll(isNearBottom);
  }, []);

  const handleAgentChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>): void => {
    setSelectedAgent(e.target.value === "" ? null : e.target.value);
  }, []);

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>): void => {
    setSelectedType(e.target.value === "" ? null : (e.target.value as EventType));
  }, []);

  // ---- Render ----
  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-md">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-700 px-4 py-2">
        <span className="text-xs font-medium text-gray-400">Filters</span>

        {/* Agent filter */}
        <select
          value={selectedAgent ?? ""}
          onChange={handleAgentChange}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-200 outline-none focus:border-blue-500"
          aria-label="Filter by agent"
        >
          <option value="">All agents</option>
          {agentIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        {/* Event type filter */}
        <select
          value={selectedType ?? ""}
          onChange={handleTypeChange}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-200 outline-none focus:border-blue-500"
          aria-label="Filter by event type"
        >
          <option value="">All types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Auto-scroll indicator */}
        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
            }}
            className="ml-auto rounded bg-blue-800 px-2 py-0.5 text-xs text-blue-200 transition-colors hover:bg-blue-700"
          >
            Resume auto-scroll
          </button>
        )}

        <span className="ml-auto text-xs text-gray-500">
          {filteredEvents.length} / {events.length} events
        </span>
      </div>

      {/* Log area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-gray-950 font-mono text-xs"
      >
        {filteredEvents.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-500">
            {events.length === 0 ? "No events yet" : "No events match the current filters"}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {filteredEvents.map((event, idx) => {
                const style = EVENT_TYPE_STYLES[event.type];
                const details = summarizeDetails(event.details);

                return (
                  <tr
                    key={`${event.ts}-${String(idx)}`}
                    className="border-b border-gray-800 hover:bg-gray-900"
                  >
                    {/* Timestamp */}
                    <td className="whitespace-nowrap px-3 py-1 text-gray-500">
                      {formatTimestamp(event.ts)}
                    </td>

                    {/* Event type badge */}
                    <td className="px-2 py-1">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
                      >
                        {event.type}
                      </span>
                    </td>

                    {/* Node ID */}
                    <td className="whitespace-nowrap px-2 py-1 text-gray-400">
                      {event.nodeId ?? "—"}
                    </td>

                    {/* Agent ID */}
                    <td className="whitespace-nowrap px-2 py-1 text-gray-400">
                      {event.agentId ?? "—"}
                    </td>

                    {/* Details summary */}
                    <td className="truncate px-2 py-1 text-gray-300">{details || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
