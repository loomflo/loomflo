// ============================================================================
// NodeCard Component
//
// Compact card displaying a workflow node summary with status badge,
// agent count, cost, and optional retry indicator. Designed for list
// or grid layouts on the dark-themed dashboard.
// ============================================================================

import { memo, useCallback } from "react";
import type { ReactElement } from "react";

import type { NodeStatus } from "../lib/types.js";

// ============================================================================
// Types
// ============================================================================

/** Props for the {@link NodeCard} component. */
export interface NodeCardProps {
  /** Unique node identifier. */
  id: string;
  /** Human-readable node title. */
  title: string;
  /** Current node execution status. */
  status: NodeStatus;
  /** Number of agents assigned to this node. */
  agentCount: number;
  /** Accumulated cost in USD. */
  cost: number;
  /** Number of retry cycles attempted. */
  retryCount: number;
  /** Callback invoked with the node ID when the card is clicked. */
  onClick?: (id: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Status-to-Tailwind class mapping for the color-coded badge. */
const STATUS_BADGE_STYLES: Record<NodeStatus, { bg: string; text: string }> = {
  pending: { bg: "bg-gray-700", text: "text-gray-300" },
  waiting: { bg: "bg-amber-900", text: "text-amber-300" },
  running: { bg: "bg-blue-900", text: "text-blue-300" },
  review: { bg: "bg-purple-900", text: "text-purple-300" },
  done: { bg: "bg-green-900", text: "text-green-300" },
  failed: { bg: "bg-red-900", text: "text-red-300" },
  blocked: { bg: "bg-orange-900", text: "text-orange-300" },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a numeric USD value as a currency string (e.g., `$0.32`).
 *
 * @param value - Cost in USD.
 * @returns Formatted currency string.
 */
function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

// ============================================================================
// NodeCard Component
// ============================================================================

/**
 * Compact card displaying a workflow node summary.
 *
 * Shows the node title, a color-coded status badge, agent count,
 * accumulated cost, and retry count (when non-zero). The entire card
 * is clickable and calls {@link NodeCardProps.onClick} with the node ID.
 *
 * @param props - Node summary data and optional click handler.
 * @returns Rendered node card element.
 */
export const NodeCard = memo(function NodeCard({
  id,
  title,
  status,
  agentCount,
  cost,
  retryCount,
  onClick,
}: NodeCardProps): ReactElement {
  const badge = STATUS_BADGE_STYLES[status];

  const handleClick = useCallback((): void => {
    onClick?.(id);
  }, [onClick, id]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-left shadow-md transition-colors hover:border-gray-500 hover:bg-gray-800"
    >
      {/* Title */}
      <div className="truncate text-sm font-medium text-gray-100">{title}</div>

      {/* Status badge */}
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}${
            status === "running" ? " animate-pulse" : ""
          }`}
        >
          {status}
        </span>
      </div>

      {/* Metrics row */}
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
        <span>
          {agentCount} {agentCount === 1 ? "agent" : "agents"}
        </span>
        <span>{formatUsd(cost)}</span>
        {retryCount > 0 && (
          <span className="text-amber-400">
            {retryCount} {retryCount === 1 ? "retry" : "retries"}
          </span>
        )}
      </div>
    </button>
  );
});
