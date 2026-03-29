// ============================================================================
// CostTracker Component
//
// Displays workflow cost tracking with a budget progress bar (when a budget
// is set), per-node cost breakdown table, loom overhead, and totals.
// Designed for the dark-themed monitoring dashboard.
// ============================================================================

import { memo, useMemo } from 'react';
import type { ReactElement } from 'react';

// ============================================================================
// Types
// ============================================================================

/** Per-node cost entry for the breakdown table. */
export interface NodeCostEntry {
  /** Unique node identifier. */
  id: string;
  /** Human-readable node title. */
  title: string;
  /** Accumulated cost in USD for this node. */
  cost: number;
  /** Number of retry cycles attempted. */
  retries: number;
}

/** Props for the {@link CostTracker} component. */
export interface CostTrackerProps {
  /** Total accumulated cost in USD across all nodes. */
  total: number;
  /** Maximum budget in USD, or null if no limit is set. */
  budgetLimit: number | null;
  /** Remaining budget in USD, or null if no limit is set. */
  budgetRemaining: number | null;
  /** Per-node cost breakdown entries. */
  nodes: NodeCostEntry[];
  /** Loom (architect) overhead cost in USD. */
  loomCost: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Threshold percentages for progress bar color transitions. */
const BUDGET_THRESHOLDS = {
  warning: 0.6,
  danger: 0.85,
} as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a numeric USD value as a currency string (e.g., `$0.32`).
 *
 * @param value - Cost in USD.
 * @returns Formatted currency string with two decimal places.
 */
function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Determine the Tailwind background class for the progress bar based on
 * budget usage ratio. Green below 60%, yellow 60–85%, red above 85%.
 *
 * @param ratio - Budget usage ratio between 0 and 1.
 * @returns Tailwind CSS background class string.
 */
function getBarColorClass(ratio: number): string {
  if (ratio >= BUDGET_THRESHOLDS.danger) {
    return 'bg-red-500';
  }
  if (ratio >= BUDGET_THRESHOLDS.warning) {
    return 'bg-yellow-500';
  }
  return 'bg-green-500';
}

// ============================================================================
// CostTracker Component
// ============================================================================

/**
 * Displays workflow cost tracking information.
 *
 * When a budget limit is configured, renders a color-coded progress bar
 * (green → yellow → red) showing spend against the limit. Always renders
 * a per-node cost breakdown table, loom overhead row, and total cost.
 *
 * @param props - Cost data including totals, budget, and per-node breakdown.
 * @returns Rendered cost tracker panel element.
 */
export const CostTracker = memo(function CostTracker({
  total,
  budgetLimit,
  budgetRemaining,
  nodes,
  loomCost,
}: CostTrackerProps): ReactElement {
  const budgetRatio = useMemo((): number | null => {
    if (budgetLimit === null || budgetLimit === 0) {
      return null;
    }
    return Math.min(total / budgetLimit, 1);
  }, [total, budgetLimit]);

  const barColorClass = useMemo((): string | null => {
    if (budgetRatio === null) {
      return null;
    }
    return getBarColorClass(budgetRatio);
  }, [budgetRatio]);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 shadow-md">
      {/* Header */}
      <h3 className="text-sm font-semibold text-gray-100">Cost Tracker</h3>

      {/* Budget progress bar — only when a budget limit is set */}
      {budgetLimit !== null && budgetRatio !== null && barColorClass !== null && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{formatUsd(total)} spent</span>
            <span>{formatUsd(budgetLimit)} budget</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-700">
            <div
              className={`h-full rounded-full transition-all ${barColorClass}`}
              style={{ width: `${(budgetRatio * 100).toFixed(1)}%` }}
            />
          </div>
          {budgetRemaining !== null && (
            <div className="mt-1 text-xs text-gray-400">
              {formatUsd(budgetRemaining)} remaining
            </div>
          )}
        </div>
      )}

      {/* Per-node cost breakdown table */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="pb-2 pr-4 font-medium">Node</th>
              <th className="pb-2 pr-4 text-right font-medium">Cost</th>
              <th className="pb-2 text-right font-medium">Retries</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map(
              (node): ReactElement => (
                <tr key={node.id} className="border-b border-gray-800">
                  <td className="py-1.5 pr-4 text-gray-300">{node.title}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-gray-300">
                    {formatUsd(node.cost)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-300">
                    {node.retries > 0 ? (
                      <span className="text-amber-400">{node.retries}</span>
                    ) : (
                      <span>0</span>
                    )}
                  </td>
                </tr>
              ),
            )}
            {/* Loom overhead row */}
            <tr className="border-b border-gray-800">
              <td className="py-1.5 pr-4 italic text-gray-500">Loom overhead</td>
              <td className="py-1.5 pr-4 text-right tabular-nums text-gray-500">
                {formatUsd(loomCost)}
              </td>
              <td className="py-1.5 text-right text-gray-500">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Total cost */}
      <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3">
        <span className="text-sm font-medium text-gray-100">Total</span>
        <span className="text-sm font-semibold tabular-nums text-gray-100">
          {formatUsd(total)}
        </span>
      </div>
    </div>
  );
});
