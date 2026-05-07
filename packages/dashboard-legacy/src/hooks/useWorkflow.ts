// ============================================================================
// useWorkflow Hook
//
// Fetches workflow state via REST and keeps it in sync with real-time
// WebSocket events from the Loomflo daemon.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

import type { Node, Workflow } from "../lib/types.js";
import { useProject } from "../context/ProjectContext.js";
import { useWebSocket } from "./useWebSocket.js";

// ============================================================================
// Types
// ============================================================================

/** Return value of the useWorkflow hook. */
export interface UseWorkflowReturn {
  /** Current workflow state, or null if no workflow is active. */
  workflow: Workflow | null;
  /** All nodes in the workflow graph. */
  nodes: Node[];
  /** Whether the initial data fetch is in progress. */
  loading: boolean;
  /** Error message from the most recent fetch, or null. */
  error: string | null;
  /** Manually trigger a full refetch of workflow and nodes. */
  refetch: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * React hook that fetches the current workflow and node state via REST,
 * then subscribes to WebSocket events to keep the state updated in real-time.
 *
 * @param projectId - The project to fetch workflow data for.
 * @returns Workflow state, nodes, loading/error indicators, and a refetch trigger.
 */
export function useWorkflow(projectId: string): UseWorkflowReturn {
  const { client, baseUrl, token } = useProject();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch workflow and nodes from the REST API.
   * A 404 on the workflow endpoint is treated as "no active workflow" (null),
   * not as an error.
   */
  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const [workflowResult, nodesResult] = await Promise.allSettled([
        client.getWorkflow(projectId),
        client.getNodes(projectId),
      ]);

      if (workflowResult.status === "fulfilled") {
        setWorkflow(workflowResult.value);
      } else {
        const reason = workflowResult.reason as unknown;
        if (reason instanceof Error && reason.message.includes("404")) {
          setWorkflow(null);
        } else {
          setError(reason instanceof Error ? reason.message : "Failed to fetch workflow");
        }
      }

      if (nodesResult.status === "fulfilled") {
        setNodes(nodesResult.value);
      } else {
        const reason = nodesResult.reason as unknown;
        if (!(reason instanceof Error && reason.message.includes("404"))) {
          setError(
            (prev) => prev ?? (reason instanceof Error ? reason.message : "Failed to fetch nodes"),
          );
        }
      }
    } finally {
      setLoading(false);
    }
  }, [client, projectId]);

  /** Fetch data on mount. */
  useEffect((): void => {
    void fetchData();
  }, [fetchData]);

  /** Subscribe to WebSocket events and update state accordingly. */
  useWebSocket({
    baseUrl,
    token,
    subscribe: { projectIds: [projectId] },
    onMessage: (frame): void => {
      const type = frame["type"] as string | undefined;

      if (type === "workflow_status") {
        const status = frame["status"] as string;
        setWorkflow((prev) => (prev ? { ...prev, status: status as Workflow["status"] } : prev));
      }

      if (type === "node_status") {
        const nodeId = frame["nodeId"] as string;
        const status = frame["status"] as string;
        setNodes((prev) =>
          prev.map((node) =>
            node.id === nodeId ? { ...node, status: status as Node["status"] } : node,
          ),
        );
      }

      if (type === "agent_status") {
        const status = frame["status"] as string;
        if (status === "created") {
          const nodeId = frame["nodeId"] as string;
          setNodes((prev) =>
            prev.map((node) =>
              node.id === nodeId ? { ...node, agents: [...node.agents] } : node,
            ),
          );
        }
      }

      if (type === "graph_modified") {
        void fetchData();
      }

      if (type === "cost_update") {
        const nodeId = frame["nodeId"] as string;
        const nodeCost = frame["nodeCost"] as number;
        const totalCost = frame["totalCost"] as number;
        setNodes((prev) =>
          prev.map((node) => (node.id === nodeId ? { ...node, cost: nodeCost } : node)),
        );
        setWorkflow((prev) => (prev ? { ...prev, totalCost } : prev));
      }
    },
  });

  /** Manual refetch trigger exposed to consumers. */
  const refetch = useCallback((): void => {
    void fetchData();
  }, [fetchData]);

  return { workflow, nodes, loading, error, refetch };
}
