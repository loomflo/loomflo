// ============================================================================
// useWorkflow
//
// Loads `GET /projects/:id/workflow` and patches the cached graph in place
// when the daemon broadcasts node_status / graph_modified / cost_update.
// ============================================================================

import { useEffect } from "react";
import { useApi, useWs } from "../context/AppContext.js";
import type { Node, Workflow } from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

export interface WorkflowResource {
  workflow: Workflow | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useWorkflow(projectId: string | null | undefined): WorkflowResource {
  const api = useApi();
  const ws = useWs();

  const res = useAsyncResource<Workflow>(
    async () => {
      if (!projectId) throw new Error("No projectId");
      return api.getWorkflow(projectId);
    },
    [api, projectId],
  );

  useEffect(() => {
    if (!projectId) return;
    const off1 = ws.on("node_status", (ev) => {
      if (ev.projectId !== undefined && ev.projectId !== projectId) return;
      res.set((prev) => {
        if (!prev) return prev;
        const node = prev.graph.nodes[ev.nodeId];
        if (!node) return prev;
        const patched: Node = { ...node, status: ev.status };
        return {
          ...prev,
          graph: { ...prev.graph, nodes: { ...prev.graph.nodes, [ev.nodeId]: patched } },
          updatedAt: ev.timestamp,
        };
      });
    });
    const off2 = ws.on("graph_modified", (ev) => {
      if (ev.projectId !== undefined && ev.projectId !== projectId) return;
      void res.refresh();
    });
    const off3 = ws.on("cost_update", (ev) => {
      if (ev.projectId !== undefined && ev.projectId !== projectId) return;
      res.set((prev) => {
        if (!prev) return prev;
        const node = prev.graph.nodes[ev.nodeId];
        if (!node) return { ...prev, totalCost: ev.totalCost };
        return {
          ...prev,
          totalCost: ev.totalCost,
          graph: {
            ...prev.graph,
            nodes: {
              ...prev.graph.nodes,
              [ev.nodeId]: { ...node, cost: ev.nodeCost },
            },
          },
        };
      });
    });
    return () => {
      off1();
      off2();
      off3();
    };
  }, [ws, projectId, res]);

  return {
    workflow: res.data,
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
  };
}
