// ============================================================================
// Costs Page
//
// Dedicated cost tracking page displaying the CostTracker component with
// budget gauge, per-node cost breakdown (including retries), and totals.
// Subscribes to WebSocket events for real-time cost updates.
// ============================================================================

import { memo } from 'react';
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { CostTracker } from '../components/CostTracker.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useCosts } from '../hooks/useCosts.js';

// ============================================================================
// CostsPage Component
// ============================================================================

/**
 * Costs page displaying comprehensive cost tracking for the active workflow.
 *
 * Renders the {@link CostTracker} component with budget gauge, per-node cost
 * breakdown (including retries), loom overhead, and totals. Connects to the
 * Loomflo daemon via {@link useWebSocket} (token read from the `?token=`
 * query parameter) and subscribes to `cost_update` events for real-time
 * updates through {@link useCosts}.
 *
 * @returns Rendered costs page element.
 */
export const CostsPage = memo(function CostsPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const { subscribe } = useWebSocket(token);
  const { total, budgetLimit, budgetRemaining, nodes, loomCost, loading, error } =
    useCosts(subscribe);

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

  if (nodes.length === 0 && total === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-300">
            No active workflow
          </p>
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
          total={total}
          budgetLimit={budgetLimit}
          budgetRemaining={budgetRemaining}
          nodes={nodes}
          loomCost={loomCost}
        />
      </div>
    </div>
  );
});
