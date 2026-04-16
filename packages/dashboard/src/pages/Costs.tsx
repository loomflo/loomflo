// ============================================================================
// Costs Page
//
// Dedicated cost tracking page displaying the CostTracker component with
// budget gauge, per-node cost breakdown (including retries), and totals.
// Subscribes to WebSocket events for real-time cost updates.
// ============================================================================

import { memo, useMemo } from "react";
import type { ReactElement } from "react";

import { CostTracker } from "../components/CostTracker.js";
import type { NodeCostEntry } from "../components/CostTracker.js";
import { useProjectId } from "../context/ProjectContext.js";
import { useCosts } from "../hooks/useCosts.js";

// ============================================================================
// CostsPage Component
// ============================================================================

/**
 * Costs page displaying comprehensive cost tracking for the active workflow.
 *
 * Renders the {@link CostTracker} component with budget gauge, per-node cost
 * breakdown (including retries), loom overhead, and totals. Reads projectId
 * from URL params and subscribes to `cost_update` events for real-time
 * updates through {@link useCosts}.
 *
 * @returns Rendered costs page element.
 */
export const CostsPage = memo(function CostsPage(): ReactElement {
  const projectId = useProjectId();
  const { entries, totalCost, loading, error } = useCosts(projectId);

  /** Aggregate CostEntry[] into per-node NodeCostEntry[] for CostTracker. */
  const nodeCostEntries = useMemo((): NodeCostEntry[] => {
    const map = new Map<string, { cost: number; count: number }>();
    for (const entry of entries) {
      const existing = map.get(entry.nodeId);
      if (existing) {
        existing.cost += entry.cost;
        existing.count += 1;
      } else {
        map.set(entry.nodeId, { cost: entry.cost, count: 1 });
      }
    }
    return Array.from(map.entries()).map(([nodeId, data]) => ({
      id: nodeId,
      title: nodeId,
      cost: data.cost,
      retries: 0,
    }));
  }, [entries]);

  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
          <p className="text-sm text-gray-400">Loading costs…</p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Error state
  // --------------------------------------------------------------------------

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------

  if (entries.length === 0 && totalCost === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-300">No active workflow</p>
          <p className="mt-2 text-sm text-gray-500">
            Cost data will appear here once a workflow is running.
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Loaded state
  // --------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Page header */}
      <h2 className="text-2xl font-semibold text-gray-100">Costs</h2>

      {/* Cost Breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Cost Breakdown
        </h3>
        <CostTracker
          total={totalCost}
          budgetLimit={null}
          budgetRemaining={null}
          nodes={nodeCostEntries}
          loomCost={0}
        />
      </div>
    </div>
  );
});
