// ============================================================================
// Graph Page
//
// Full-screen workflow graph visualization with a real-time status bar.
// Renders the DAG using GraphView and navigates to /node/:id on click.
// ============================================================================

import { memo, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { Edge, Node, NodeStatus } from '../lib/types.js';
import type { NodeSummary } from '../lib/api.js';
import { GraphView } from '../components/GraphView.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useWorkflow } from '../hooks/useWorkflow.js';

// ============================================================================
// Constants
// ============================================================================

/** Node statuses displayed as individual counters in the status bar. */
const TRACKED_STATUSES: readonly {
  key: NodeStatus;
  label: string;
  color: string;
}[] = [
  { key: 'done', label: 'Done', color: 'text-green-400' },
  { key: 'running', label: 'Running', color: 'text-blue-400' },
  { key: 'failed', label: 'Failed', color: 'text-red-400' },
] as const;

// ============================================================================
// StatusBar Component
// ============================================================================

/** Props for the {@link StatusBar} sub-component. */
interface StatusBarProps {
  /** Current workflow lifecycle status. */
  workflowStatus: string;
  /** All node summaries used to compute per-status counts. */
  nodes: readonly NodeSummary[];
  /** Total accumulated cost in USD across all nodes. */
  totalCost: number;
}

/**
 * Horizontal status bar displaying workflow status, node counts by state,
 * and total cost. Placed at the top of the graph page.
 *
 * @param props - Workflow status, node summaries, and total cost.
 * @returns Rendered status bar element.
 */
const StatusBar = memo(function StatusBar({
  workflowStatus,
  nodes,
  totalCost,
}: StatusBarProps): ReactElement {
  const counts = useMemo((): Map<NodeStatus, number> => {
    const map = new Map<NodeStatus, number>();
    for (const node of nodes) {
      map.set(node.status, (map.get(node.status) ?? 0) + 1);
    }
    return map;
  }, [nodes]);

  return (
    <div className="flex items-center gap-6 border-b border-gray-800 bg-gray-900 px-6 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500">
          Status
        </span>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-sm font-medium text-gray-200">
          {workflowStatus}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500">
          Nodes
        </span>
        <span className="text-sm font-medium text-gray-200">{nodes.length}</span>
      </div>

      {TRACKED_STATUSES.map(({ key, label, color }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gray-500">
            {label}
          </span>
          <span className={`text-sm font-medium ${color}`}>
            {counts.get(key) ?? 0}
          </span>
        </div>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500">
          Cost
        </span>
        <span className="text-sm font-medium text-gray-200">
          ${totalCost.toFixed(4)}
        </span>
      </div>
    </div>
  );
});

// ============================================================================
// GraphPage Component
// ============================================================================

/**
 * Full-screen graph page that visualizes the workflow DAG with live status
 * updates. A status bar at the top shows workflow status, per-state node
 * counts, and total cost. Clicking a node navigates to `/node/:id`.
 *
 * Connects to the Loomflo daemon via {@link useWebSocket} (token read from
 * the `?token=` query parameter) and fetches workflow state through
 * {@link useWorkflow}, which combines REST polling with WebSocket events.
 *
 * @returns Rendered graph page filling the parent container.
 */
export const GraphPage = memo(function GraphPage(): ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const { subscribe } = useWebSocket(token);
  const { workflow, nodes, loading, error } = useWorkflow(subscribe);

  /** Navigate to the node detail page when a graph node is clicked. */
  const handleNodeClick = useCallback(
    (nodeId: string): void => {
      navigate(`/node/${encodeURIComponent(nodeId)}`);
    },
    [navigate],
  );

  /**
   * Build full Node[] from the workflow graph, overlaying live status
   * from the WebSocket-updated NodeSummary array.
   */
  const graphNodes = useMemo((): Node[] => {
    if (!workflow) return [];
    const statusMap = new Map<string, NodeStatus>(
      nodes.map((n) => [n.id, n.status]),
    );
    return Object.values(workflow.graph.nodes).map(
      (node): Node => ({
        ...node,
        status: statusMap.get(node.id) ?? node.status,
      }),
    );
  }, [workflow, nodes]);

  /** Extract edges from the workflow graph. */
  const graphEdges = useMemo((): Edge[] => {
    return workflow?.graph.edges ?? [];
  }, [workflow]);

  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
          <p className="text-sm text-gray-400">Loading workflow…</p>
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

  if (!workflow) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-300">
            No active workflow
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Initialize a workflow to see the execution graph.
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Graph view with status bar
  // --------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <StatusBar
        workflowStatus={workflow.status}
        nodes={nodes}
        totalCost={workflow.totalCost}
      />
      <div className="min-h-0 flex-1">
        <GraphView
          nodes={graphNodes}
          edges={graphEdges}
          onNodeClick={handleNodeClick}
        />
      </div>
    </div>
  );
});
