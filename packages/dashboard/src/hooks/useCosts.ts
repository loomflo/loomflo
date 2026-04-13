// ============================================================================
// useCosts Hook
//
// Fetches cost data via REST and keeps it in sync with real-time
// WebSocket cost_update events from the Loomflo daemon.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

import { apiClient, ApiError } from "../lib/api.js";
import type { CostsResponse, NodeCostEntry } from "../lib/api.js";
import type { UseWebSocketReturn } from "./useWebSocket.js";

// ============================================================================
// Types
// ============================================================================

/** The subscribe function signature extracted from useWebSocket. */
export type Subscribe = UseWebSocketReturn["subscribe"];

/** Return value of the useCosts hook. */
export interface UseCostsReturn {
  /** Total accumulated cost in USD across all nodes. */
  total: number;
  /** Configured budget limit in USD, or null if no limit is set. */
  budgetLimit: number | null;
  /** Remaining budget in USD, or null if no limit is set. */
  budgetRemaining: number | null;
  /** Per-node cost breakdown entries. */
  nodes: NodeCostEntry[];
  /** Cost in USD attributed to the Loom architect agent. */
  loomCost: number;
  /** Whether the initial data fetch is in progress. */
  loading: boolean;
  /** Error message from the most recent fetch, or null. */
  error: string | null;
  /** Manually trigger a full refetch of cost data. */
  refetch: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * React hook that fetches cost data via REST and subscribes to
 * WebSocket cost_update events for real-time updates.
 *
 * The hook initially loads the full cost breakdown from GET /costs,
 * then incrementally updates per-node costs and totals as cost_update
 * events arrive over the WebSocket connection.
 *
 * @param subscribe - The subscribe function from {@link useWebSocket}.
 * @returns Cost state including totals, budget info, per-node breakdown, and controls.
 */
export function useCosts(subscribe: Subscribe): UseCostsReturn {
  const [total, setTotal] = useState(0);
  const [budgetLimit, setBudgetLimit] = useState<number | null>(null);
  const [budgetRemaining, setBudgetRemaining] = useState<number | null>(null);
  const [nodes, setNodes] = useState<NodeCostEntry[]>([]);
  const [loomCost, setLoomCost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch full cost data from the REST API.
   * A 404 means no active workflow — reset to zero state.
   */
  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const data: CostsResponse = await apiClient.getCosts();
      setTotal(data.total);
      setBudgetLimit(data.budgetLimit);
      setBudgetRemaining(data.budgetRemaining);
      setNodes(data.nodes);
      setLoomCost(data.loomCost);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        setTotal(0);
        setBudgetLimit(null);
        setBudgetRemaining(null);
        setNodes([]);
        setLoomCost(0);
      } else {
        setError(err instanceof Error ? err.message : "Failed to fetch cost data");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fetch data on mount. */
  useEffect((): void => {
    void fetchData();
  }, [fetchData]);

  /** Subscribe to WebSocket cost_update events and update state. */
  useEffect((): (() => void) => {
    const unsub = subscribe("cost_update", (event): void => {
      setTotal(event.totalCost);

      setBudgetRemaining(event.budgetRemaining);

      setNodes((prev) =>
        prev.map((node) => (node.id === event.nodeId ? { ...node, cost: event.nodeCost } : node)),
      );
    });

    return unsub;
  }, [subscribe]);

  /** Manual refetch trigger exposed to consumers. */
  const refetch = useCallback((): void => {
    void fetchData();
  }, [fetchData]);

  return {
    total,
    budgetLimit,
    budgetRemaining,
    nodes,
    loomCost,
    loading,
    error,
    refetch,
  };
}
