// ============================================================================
// useCosts
//
// Loads `GET /projects/:id/costs` and patches per-node + total cost from
// `cost_update` WS events.
// ============================================================================

import { useEffect } from "react";
import { useApi, useWs } from "../context/AppContext.js";
import type { CostsResponse } from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

export function useCosts(projectId: string | null | undefined): {
  costs: CostsResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const api = useApi();
  const ws = useWs();

  const res = useAsyncResource<CostsResponse>(
    async () => {
      if (!projectId) throw new Error("No projectId");
      return api.getCosts(projectId);
    },
    [api, projectId],
  );

  useEffect(() => {
    if (!projectId) return;
    const off = ws.on("cost_update", (ev) => {
      if (ev.projectId !== undefined && ev.projectId !== projectId) return;
      res.set((prev) => {
        if (!prev) return prev;
        const nodes = prev.nodes.map((n) =>
          n.id === ev.nodeId ? { ...n, cost: ev.nodeCost } : n,
        );
        return {
          ...prev,
          total: ev.totalCost,
          nodes,
          budgetRemaining: ev.budgetRemaining ?? prev.budgetRemaining,
        };
      });
    });
    return off;
  }, [ws, projectId, res]);

  return { costs: res.data, loading: res.loading, error: res.error, refresh: res.refresh };
}
