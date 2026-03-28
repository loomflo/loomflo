// ============================================================================
// useWorkflow Hook
//
// Fetches workflow state via REST and keeps it in sync with real-time
// WebSocket events from the Loomflo daemon.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';

import type { Workflow } from '../lib/types.js';
import { apiClient, ApiError } from '../lib/api.js';
import type { NodeSummary } from '../lib/api.js';
import type { UseWebSocketReturn } from './useWebSocket.js';

// ============================================================================
// Types
// ============================================================================

/** The subscribe function signature extracted from useWebSocket. */
export type Subscribe = UseWebSocketReturn['subscribe'];

/** Return value of the useWorkflow hook. */
export interface UseWorkflowReturn {
  /** Current workflow state, or null if no workflow is active. */
  workflow: Workflow | null;
  /** All nodes in the workflow graph. */
  nodes: NodeSummary[];
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
 * @param subscribe - The subscribe function from {@link useWebSocket}.
 * @returns Workflow state, nodes, loading/error indicators, and a refetch trigger.
 */
export function useWorkflow(subscribe: Subscribe): UseWorkflowReturn {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
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
        apiClient.getWorkflow(),
        apiClient.getNodes(),
      ]);

      if (workflowResult.status === 'fulfilled') {
        setWorkflow(workflowResult.value);
      } else {
        const reason = workflowResult.reason as unknown;
        if (reason instanceof ApiError && reason.status === 404) {
          setWorkflow(null);
        } else {
          setError(
            reason instanceof Error ? reason.message : 'Failed to fetch workflow',
          );
        }
      }

      if (nodesResult.status === 'fulfilled') {
        setNodes(nodesResult.value.nodes);
      } else {
        const reason = nodesResult.reason as unknown;
        if (!(reason instanceof ApiError && reason.status === 404)) {
          setError((prev) =>
            prev ?? (reason instanceof Error ? reason.message : 'Failed to fetch nodes'),
          );
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fetch data on mount. */
  useEffect((): void => {
    void fetchData();
  }, [fetchData]);

  /** Subscribe to WebSocket events and update state accordingly. */
  useEffect((): (() => void) => {
    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(
      subscribe('workflow_status', (event): void => {
        setWorkflow((prev) =>
          prev ? { ...prev, status: event.status } : prev,
        );
      }),
    );

    unsubscribers.push(
      subscribe('node_status', (event): void => {
        setNodes((prev) =>
          prev.map((node) =>
            node.id === event.nodeId ? { ...node, status: event.status } : node,
          ),
        );
      }),
    );

    unsubscribers.push(
      subscribe('agent_status', (event): void => {
        if (event.status === 'created') {
          setNodes((prev) =>
            prev.map((node) =>
              node.id === event.nodeId
                ? { ...node, agentCount: node.agentCount + 1 }
                : node,
            ),
          );
        }
      }),
    );

    unsubscribers.push(
      subscribe('graph_modified', (): void => {
        void fetchData();
      }),
    );

    unsubscribers.push(
      subscribe('cost_update', (event): void => {
        setNodes((prev) =>
          prev.map((node) =>
            node.id === event.nodeId ? { ...node, cost: event.nodeCost } : node,
          ),
        );
        setWorkflow((prev) =>
          prev ? { ...prev, totalCost: event.totalCost } : prev,
        );
      }),
    );

    return (): void => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [subscribe, fetchData]);

  /** Manual refetch trigger exposed to consumers. */
  const refetch = useCallback((): void => {
    void fetchData();
  }, [fetchData]);

  return { workflow, nodes, loading, error, refetch };
}
