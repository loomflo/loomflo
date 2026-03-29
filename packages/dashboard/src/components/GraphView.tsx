// ============================================================================
// GraphView Component
//
// React Flow wrapper that visualizes the Loomflo workflow DAG with custom
// node rendering, status-based styling, auto-layout, and real-time updates.
// ============================================================================

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent, ReactElement } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import type { Node as RFNode, Edge as RFEdge, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Node, Edge, NodeStatus } from '../lib/types.js';

// ============================================================================
// Constants
// ============================================================================

/** Width of a rendered workflow node in pixels. */
const NODE_WIDTH = 220;

/** Height of a rendered workflow node in pixels. */
const NODE_HEIGHT = 72;

/** Horizontal gap between nodes in the same layer. */
const HORIZONTAL_GAP = 60;

/** Vertical gap between layers. */
const VERTICAL_GAP = 100;

/** Status-to-color mapping for node badges and MiniMap. */
const STATUS_STYLES: Record<
  NodeStatus,
  { bg: string; text: string; dot: string; minimap: string }
> = {
  pending: {
    bg: 'bg-gray-500/20',
    text: 'text-gray-400',
    dot: 'bg-gray-400',
    minimap: '#6b7280',
  },
  waiting: {
    bg: 'bg-amber-500/20',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
    minimap: '#f59e0b',
  },
  running: {
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
    minimap: '#3b82f6',
  },
  review: {
    bg: 'bg-purple-500/20',
    text: 'text-purple-400',
    dot: 'bg-purple-400',
    minimap: '#a855f7',
  },
  done: {
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    dot: 'bg-green-400',
    minimap: '#22c55e',
  },
  failed: {
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    dot: 'bg-red-400',
    minimap: '#ef4444',
  },
  blocked: {
    bg: 'bg-orange-500/20',
    text: 'text-orange-400',
    dot: 'bg-orange-400',
    minimap: '#f97316',
  },
};

/** Edge color for completed paths. */
const EDGE_COLOR_DONE = '#22c55e';

/** Edge color for pending/in-progress paths. */
const EDGE_COLOR_PENDING = '#4b5563';

// ============================================================================
// Types
// ============================================================================

/** Duration of the node enter animation in milliseconds. */
const NODE_ENTER_DURATION_MS = 400;

/** Duration of the new-edge animated state in milliseconds. */
const EDGE_ENTER_DURATION_MS = 500;

/** CSS keyframe animation for newly added nodes. */
const ENTER_ANIMATION_STYLES = `
@keyframes loomflo-node-enter {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.animate-node-enter {
  animation: loomflo-node-enter ${String(NODE_ENTER_DURATION_MS)}ms ease-out both;
}
`;

/** Data payload for the custom workflow node in React Flow. */
interface WorkflowNodeData {
  /** Human-readable node title. */
  title: string;
  /** Current node execution status. */
  status: NodeStatus;
  /** Whether this node was just added and should play the enter animation. */
  isNew?: boolean;
  [key: string]: unknown;
}

/** React Flow node type for workflow nodes. */
type WorkflowFlowNode = RFNode<WorkflowNodeData, 'workflow'>;

/** Props for the GraphView component. */
export interface GraphViewProps {
  /** Loomflo workflow nodes to visualize. */
  nodes: Node[];
  /** Directed edges between workflow nodes. */
  edges: Edge[];
  /** Callback invoked when a node is clicked. */
  onNodeClick?: (nodeId: string) => void;
  /** When true, newly added nodes and edges play an enter animation. Defaults to false. */
  animate?: boolean;
}

// ============================================================================
// Layout Algorithm
// ============================================================================

/**
 * Compute positions for nodes in a top-down DAG layout using Kahn's
 * algorithm for topological layer assignment.
 *
 * Nodes are organized into horizontal layers based on graph depth, then
 * centered within each layer for a balanced visual layout.
 *
 * @param nodes - Loomflo workflow nodes.
 * @param edges - Directed edges defining the graph topology.
 * @returns Map from node ID to pixel position.
 */
function computeLayout(
  nodes: Node[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    children.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    children.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let queue = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);

  while (queue.length > 0) {
    layers.push([...queue]);
    const next: string[] = [];
    for (const id of queue) {
      for (const child of children.get(id) ?? []) {
        const deg = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, deg);
        if (deg === 0) next.push(child);
      }
    }
    queue = next;
  }

  const positions = new Map<string, { x: number; y: number }>();
  const maxLayerSize = Math.max(...layers.map((l) => l.length));
  const totalMaxWidth =
    maxLayerSize * NODE_WIDTH + (maxLayerSize - 1) * HORIZONTAL_GAP;

  for (const [layerIdx, layer] of layers.entries()) {
    const layerWidth =
      layer.length * NODE_WIDTH + (layer.length - 1) * HORIZONTAL_GAP;
    const startX = (totalMaxWidth - layerWidth) / 2;

    for (const [nodeIdx, nodeId] of layer.entries()) {
      positions.set(nodeId, {
        x: startX + nodeIdx * (NODE_WIDTH + HORIZONTAL_GAP),
        y: layerIdx * (NODE_HEIGHT + VERTICAL_GAP),
      });
    }
  }

  return positions;
}

// ============================================================================
// Custom Node Component
// ============================================================================

/**
 * Custom React Flow node that renders a workflow step with its title
 * and a color-coded status badge. Running nodes display a pulse animation.
 *
 * @param props - React Flow node props containing workflow node data.
 * @returns Rendered workflow node element.
 */
const WorkflowNodeComponent = memo(function WorkflowNodeComponent({
  data,
}: NodeProps<WorkflowFlowNode>): ReactElement {
  const { title, status, isNew } = data;
  const style = STATUS_STYLES[status];
  const enterClass = isNew ? ' animate-node-enter' : '';

  return (
    <div className={`min-w-[200px] rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 shadow-lg${enterClass}`}>
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-gray-500 !bg-gray-600"
      />
      <div className="truncate text-sm font-medium text-gray-100">
        {title}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${style.dot}${
            status === 'running' ? ' animate-pulse' : ''
          }`}
        />
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
        >
          {status}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-gray-500 !bg-gray-600"
      />
    </div>
  );
});

/** Registered custom node types for React Flow. */
const nodeTypes = { workflow: WorkflowNodeComponent };

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Convert Loomflo nodes into React Flow node objects with computed DAG positions.
 *
 * @param nodes - Loomflo workflow nodes.
 * @param edges - Directed edges used for layout computation.
 * @returns Array of positioned React Flow node objects.
 */
function toFlowNodes(nodes: Node[], edges: Edge[]): WorkflowFlowNode[] {
  const positions = computeLayout(nodes, edges);

  return nodes.map(
    (node): WorkflowFlowNode => ({
      id: node.id,
      type: 'workflow',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { title: node.title, status: node.status },
    }),
  );
}

/**
 * Convert Loomflo edges into React Flow edge objects with status-based styling.
 *
 * Edges from completed (done) source nodes are colored green; all others are gray.
 * Edges from running source nodes are animated.
 *
 * @param edges - Loomflo directed edges.
 * @param nodeStatusMap - Map from node ID to its current execution status.
 * @returns Array of styled React Flow edge objects.
 */
function toFlowEdges(
  edges: Edge[],
  nodeStatusMap: Map<string, NodeStatus>,
): RFEdge[] {
  return edges.map((edge): RFEdge => {
    const sourceStatus = nodeStatusMap.get(edge.from);
    const isDone = sourceStatus === 'done';

    return {
      id: `${edge.from}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      animated: sourceStatus === 'running',
      style: {
        stroke: isDone ? EDGE_COLOR_DONE : EDGE_COLOR_PENDING,
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isDone ? EDGE_COLOR_DONE : EDGE_COLOR_PENDING,
        width: 20,
        height: 20,
      },
    };
  });
}

// ============================================================================
// MiniMap Helpers
// ============================================================================

/**
 * Return the minimap fill color for a node based on its workflow status.
 *
 * @param node - React Flow node with workflow data.
 * @returns Hex color string for the minimap representation.
 */
function minimapNodeColor(node: RFNode): string {
  const data = node.data as WorkflowNodeData | undefined;
  if (data?.status && data.status in STATUS_STYLES) {
    return STATUS_STYLES[data.status].minimap;
  }
  return '#6b7280';
}

// ============================================================================
// GraphView Component
// ============================================================================

/**
 * Workflow graph visualization component built on React Flow.
 *
 * Renders Loomflo workflow nodes and edges as an interactive top-down DAG
 * with auto-layout, status-based color coding, a minimap, and zoom controls.
 * The graph updates smoothly when the `nodes` or `edges` props change.
 *
 * @param props - Workflow graph data and optional node click handler.
 * @returns Rendered graph visualization that fills its parent container.
 */
export function GraphView({
  nodes,
  edges,
  onNodeClick,
  animate = false,
}: GraphViewProps): ReactElement {
  const prevNodeIdsRef = useRef(new Set<string>());
  const prevEdgeIdsRef = useRef(new Set<string>());

  const nodeStatusMap = useMemo((): Map<string, NodeStatus> => {
    const map = new Map<string, NodeStatus>();
    for (const node of nodes) {
      map.set(node.id, node.status);
    }
    return map;
  }, [nodes]);

  const initialFlowNodes = useMemo(
    (): WorkflowFlowNode[] => toFlowNodes(nodes, edges),
    [nodes, edges],
  );

  const initialFlowEdges = useMemo(
    (): RFEdge[] => toFlowEdges(edges, nodeStatusMap),
    [edges, nodeStatusMap],
  );

  const [rfNodes, setRfNodes, onNodesChange] =
    useNodesState(initialFlowNodes);
  const [rfEdges, setRfEdges, onEdgesChange] =
    useEdgesState(initialFlowEdges);

  useEffect(() => {
    const prevNodeIds = prevNodeIdsRef.current;
    const flowNodes = toFlowNodes(nodes, edges);

    if (animate) {
      const newNodeIds: string[] = [];
      for (const fn of flowNodes) {
        if (!prevNodeIds.has(fn.id)) {
          fn.data = { ...fn.data, isNew: true };
          newNodeIds.push(fn.id);
        }
      }

      setRfNodes(flowNodes);

      if (newNodeIds.length > 0) {
        const timer = setTimeout((): void => {
          setRfNodes((current) =>
            current.map((n) =>
              newNodeIds.includes(n.id)
                ? { ...n, data: { ...n.data, isNew: false } }
                : n,
            ),
          );
        }, NODE_ENTER_DURATION_MS);

        prevNodeIdsRef.current = new Set(nodes.map((n) => n.id));

        return (): void => {
          clearTimeout(timer);
        };
      }
    } else {
      setRfNodes(flowNodes);
    }

    prevNodeIdsRef.current = new Set(nodes.map((n) => n.id));
  }, [nodes, edges, setRfNodes, animate]);

  useEffect(() => {
    const prevEdgeIds = prevEdgeIdsRef.current;
    const flowEdges = toFlowEdges(edges, nodeStatusMap);

    if (animate) {
      const newEdgeIds: string[] = [];
      for (const fe of flowEdges) {
        if (!prevEdgeIds.has(fe.id)) {
          fe.animated = true;
          newEdgeIds.push(fe.id);
        }
      }

      setRfEdges(flowEdges);

      if (newEdgeIds.length > 0) {
        const timer = setTimeout((): void => {
          setRfEdges((current) =>
            current.map((e) => {
              if (!newEdgeIds.includes(e.id)) return e;
              const sourceStatus = nodeStatusMap.get(e.source);
              return { ...e, animated: sourceStatus === 'running' };
            }),
          );
        }, EDGE_ENTER_DURATION_MS);

        prevEdgeIdsRef.current = new Set(
          flowEdges.map((e) => e.id),
        );

        return (): void => {
          clearTimeout(timer);
        };
      }
    } else {
      setRfEdges(flowEdges);
    }

    prevEdgeIdsRef.current = new Set(flowEdges.map((e) => e.id));
  }, [edges, nodeStatusMap, setRfEdges, animate]);

  const handleNodeClick = useCallback(
    (_event: MouseEvent, node: RFNode): void => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  return (
    <div className="h-full w-full bg-gray-950">
      {animate && <style>{ENTER_ANIMATION_STYLES}</style>}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap nodeColor={minimapNodeColor} />
      </ReactFlow>
    </div>
  );
}
