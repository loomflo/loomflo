// ============================================================================
// useCosts Hook
//
// Fetches cost data via REST and keeps it in sync with real-time
// WebSocket cost_update events from the Loomflo daemon.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

import type { CostEntry, CostSummary } from "../lib/types.js";
import { useProject } from "../context/ProjectContext.js";
import { useWebSocket } from "./useWebSocket.js";

// ============================================================================
// Types
// ============================================================================

/** Return value of the useCosts hook. */
export interface UseCostsReturn {
  /** Cost summary data, or null if not yet loaded. */
  costs: CostSummary | null;
  /** Per-node cost entries. */
  entries: CostEntry[];
  /** Total cost in USD. */
  totalCost: number;
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
 * @param projectId - The project to fetch cost data for.
 * @returns Cost state including totals, entries, and controls.
 */
export function useCosts(projectId: string): UseCostsReturn {
  const { client, baseUrl, token } = useProject();

  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch full cost data from the REST API.
   * A 404 means no active workflow -- reset to null state.
   */
  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const data = await client.getCosts(projectId);
      setCosts(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("404")) {
        setCosts(null);
      } else {
        setError(err instanceof Error ? err.message : "Failed to fetch cost data");
      }
    } finally {
      setLoading(false);
    }
  }, [client, projectId]);

  /** Fetch data on mount. */
  useEffect((): void => {
    void fetchData();
  }, [fetchData]);

  /** Subscribe to WebSocket cost_update events and refetch. */
  useWebSocket({
    baseUrl,
    token,
    subscribe: { projectIds: [projectId] },
    onMessage: (frame): void => {
      const type = frame["type"] as string | undefined;
      if (type === "cost_update") {
        void fetchData();
      }
    },
  });

  /** Manual refetch trigger exposed to consumers. */
  const refetch = useCallback((): void => {
    void fetchData();
  }, [fetchData]);

  return {
    costs,
    entries: costs?.entries ?? [],
    totalCost: costs?.totalCost ?? 0,
    loading,
    error,
    refetch,
  };
}
