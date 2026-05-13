// ============================================================================
// Graph Page
//
// Full-screen workflow graph visualization with a real-time status bar.
// Renders the DAG using GraphView and navigates to /node/:id on click.
// During Phase 1 (spec), shows the graph forming incrementally with spec
// artifact status indicators.
// ============================================================================

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import type { Edge, Node, NodeStatus } from "../lib/types.js";
import { useProject, useProjectId } from "../context/ProjectContext.js";
import { GraphView } from "../components/GraphView.js";
import { useWebSocket } from "../hooks/useWebSocket.js";
import { useWorkflow } from "../hooks/useWorkflow.js";

// ============================================================================
// Constants
// ============================================================================

/** Node statuses displayed as individual counters in the status bar. */
const TRACKED_STATUSES: readonly {
  key: NodeStatus;
  label: string;
  color: string;
}[] = [
  { key: "done", label: "Done", color: "text-green-400" },
  { key: "running", label: "Running", color: "text-blue-400" },
  { key: "failed", label: "Failed", color: "text-red-400" },
] as const;

/** Ordered list of spec artifacts generated during Phase 1. */
const SPEC_ARTIFACT_NAMES: readonly string[] = [
  "constitution.md",
  "spec.md",
  "plan.md",
  "tasks.md",
  "analysis-report.md",
] as const;

// ============================================================================
// Spec Artifact Types
// ============================================================================

/** Display state for a single spec artifact during Phase 1. */
type SpecArtifactStatus = "pending" | "generating" | "ready";

/** A spec artifact with its current display status. */
interface SpecArtifactInfo {
  /** Artifact file name (e.g., "spec.md"). */
  name: string;
  /** Current display status. */
  status: SpecArtifactStatus;
}

// ============================================================================
// Parsing Helpers
// ============================================================================

/**
 * Parse a {@link Node} from a `graph_modified` event's `insert_node` details.
 *
 * @param details - The event details payload.
 * @returns A Node if the details contain valid node data, or null otherwise.
 */
function parseInsertedNode(details: Record<string, unknown>): Node | null {
  const raw = (details["node"] ?? details) as Record<string, unknown>;
  if (typeof raw["id"] !== "string") return null;

  const id = raw["id"];
  const title = typeof raw["title"] === "string" ? raw["title"] : id;
  const status = typeof raw["status"] === "string" ? (raw["status"] as NodeStatus) : "pending";
  const instructions = typeof raw["instructions"] === "string" ? raw["instructions"] : "";
  const delay = typeof raw["delay"] === "string" ? raw["delay"] : "0";

  return {
    id,
    title,
    status,
    instructions,
    delay,
    resumeAt: null,
    agents: [],
    fileOwnership: {},
    retryCount: 0,
    maxRetries: 0,
    reviewReport: null,
    cost: 0,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Parse an {@link Edge} from a `graph_modified` event's `add_edge` details.
 *
 * @param details - The event details payload.
 * @returns An Edge if the details contain valid edge data, or null otherwise.
 */
function parseAddedEdge(details: Record<string, unknown>): Edge | null {
  const raw = (details["edge"] ?? details) as Record<string, unknown>;
  if (typeof raw["from"] === "string" && typeof raw["to"] === "string") {
    return { from: raw["from"], to: raw["to"] };
  }
  return null;
}

// ============================================================================
// PlanningHeader Component
// ============================================================================

/**
 * Animated header displayed during Phase 1 (spec generation) indicating that
 * the workflow graph is being planned.
 *
 * @returns Rendered planning header element.
 */
const PlanningHeader = memo(function PlanningHeader(): ReactElement {
  return (
    <div className="flex items-center gap-3 border-b border-blue-900/50 bg-blue-950/40 px-6 py-3">
      <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
      <span className="text-sm font-medium text-blue-300">Planning Phase</span>
      <span className="text-sm text-blue-400/70">&mdash; Building execution graph&hellip;</span>
    </div>
  );
});

// ============================================================================
// SpecArtifactPanel Component
// ============================================================================

/** Props for the {@link SpecArtifactPanel} sub-component. */
interface SpecArtifactPanelProps {
  /** Ordered list of spec artifacts with their current display statuses. */
  artifacts: readonly SpecArtifactInfo[];
}

/**
 * Panel displaying the status of each spec artifact during Phase 1.
 * Each artifact shows as pending (gray), generating (blue pulse), or
 * ready (green check).
 *
 * @param props - The spec artifact info array.
 * @returns Rendered artifact status panel.
 */
const SpecArtifactPanel = memo(function SpecArtifactPanel({
  artifacts,
}: SpecArtifactPanelProps): ReactElement {
  return (
    <div className="flex items-center gap-4 border-b border-gray-800 bg-gray-900/60 px-6 py-2.5">
      <span className="text-xs uppercase tracking-wider text-gray-500">Artifacts</span>
      <div className="flex items-center gap-3">
        {artifacts.map((artifact) => (
          <div key={artifact.name} className="flex items-center gap-1.5">
            <ArtifactStatusIcon status={artifact.status} />
            <span
              className={`text-xs font-medium ${
                artifact.status === "ready"
                  ? "text-green-400"
                  : artifact.status === "generating"
                    ? "text-blue-400"
                    : "text-gray-500"
              }`}
            >
              {artifact.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ============================================================================
// ArtifactStatusIcon Component
// ============================================================================

/** Props for the {@link ArtifactStatusIcon} sub-component. */
interface ArtifactStatusIconProps {
  /** Current display status of the artifact. */
  status: SpecArtifactStatus;
}

/**
 * Small status icon for a spec artifact: gray circle (pending), blue pulsing
 * circle (generating), or green checkmark (ready).
 *
 * @param props - The artifact status.
 * @returns Rendered status icon element.
 */
const ArtifactStatusIcon = memo(function ArtifactStatusIcon({
  status,
}: ArtifactStatusIconProps): ReactElement {
  if (status === "ready") {
    return (
      <svg
        className="h-3.5 w-3.5 text-green-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={3}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (status === "generating") {
    return <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />;
  }

  return <span className="inline-block h-2 w-2 rounded-full bg-gray-600" />;
});

// ============================================================================
// StatusBar Component
// ============================================================================

/** Props for the {@link StatusBar} sub-component. */
interface StatusBarProps {
  /** Current workflow lifecycle status. */
  workflowStatus: string;
  /** All nodes used to compute per-status counts. */
  nodes: readonly Node[];
  /** Total accumulated cost in USD across all nodes. */
  totalCost: number;
}

/**
 * Horizontal status bar displaying workflow status, node counts by state,
 * and total cost. Placed at the top of the graph page.
 *
 * @param props - Workflow status, nodes, and total cost.
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
        <span className="text-xs uppercase tracking-wider text-gray-500">Status</span>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-sm font-medium text-gray-200">
          {workflowStatus}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500">Nodes</span>
        <span className="text-sm font-medium text-gray-200">{nodes.length}</span>
      </div>

      {TRACKED_STATUSES.map(({ key, label, color }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gray-500">{label}</span>
          <span className={`text-sm font-medium ${color}`}>{counts.get(key) ?? 0}</span>
        </div>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500">Cost</span>
        <span className="text-sm font-medium text-gray-200">${totalCost.toFixed(4)}</span>
      </div>
    </div>
  );
});

// ============================================================================
// useSpecPhase Hook
// ============================================================================

/** Return value of the {@link useSpecPhase} hook. */
interface UseSpecPhaseReturn {
  /** Ordered spec artifacts with their current display statuses. */
  artifacts: SpecArtifactInfo[];
  /** Nodes received incrementally from `graph_modified` WS events. */
  wsNodes: Node[];
  /** Edges received incrementally from `graph_modified` WS events. */
  wsEdges: Edge[];
}

/**
 * React hook that manages Phase 1 (spec) state: spec artifact tracking and
 * incremental graph node/edge accumulation from WebSocket events.
 *
 * @param projectId - The project ID to subscribe to.
 * @param isSpecPhase - Whether the workflow is currently in the spec phase.
 * @returns Artifact statuses and incrementally accumulated graph data.
 */
function useSpecPhase(projectId: string, isSpecPhase: boolean): UseSpecPhaseReturn {
  const { baseUrl, token } = useProject();
  const [readyArtifacts, setReadyArtifacts] = useState(new Set<string>());
  const [wsNodes, setWsNodes] = useState<Node[]>([]);
  const [wsEdges, setWsEdges] = useState<Edge[]>([]);

  // Reset incremental state when leaving the spec phase
  useEffect((): void => {
    if (!isSpecPhase) {
      setReadyArtifacts(new Set());
      setWsNodes([]);
      setWsEdges([]);
    }
  }, [isSpecPhase]);

  // Subscribe to spec_artifact_ready and graph_modified events
  useWebSocket({
    baseUrl,
    token,
    subscribe: { projectIds: [projectId] },
    onMessage: (frame): void => {
      if (!isSpecPhase) return;

      const type = frame["type"] as string | undefined;

      if (type === "spec_artifact_ready") {
        const name = frame["name"] as string;
        setReadyArtifacts((prev) => {
          if (prev.has(name)) return prev;
          const next = new Set(prev);
          next.add(name);
          return next;
        });
      }

      if (type === "graph_modified") {
        const action = frame["action"] as string | undefined;
        const details = (frame["details"] ?? frame) as Record<string, unknown>;

        if (action === "insert_node") {
          const node = parseInsertedNode(details);
          if (node) {
            setWsNodes((prev) => {
              if (prev.some((n) => n.id === node.id)) return prev;
              return [...prev, node];
            });
          }
        } else if (action === "add_edge") {
          const edge = parseAddedEdge(details);
          if (edge) {
            setWsEdges((prev) => {
              if (prev.some((e) => e.from === edge.from && e.to === edge.to)) return prev;
              return [...prev, edge];
            });
          }
        }
      }
    },
  });

  // Compute artifact display statuses from the ready set
  const artifacts = useMemo((): SpecArtifactInfo[] => {
    let foundGenerating = false;
    return SPEC_ARTIFACT_NAMES.map((name): SpecArtifactInfo => {
      if (readyArtifacts.has(name)) {
        return { name, status: "ready" };
      }
      if (!foundGenerating) {
        foundGenerating = true;
        return { name, status: "generating" };
      }
      return { name, status: "pending" };
    });
  }, [readyArtifacts]);

  return { artifacts, wsNodes, wsEdges };
}

// ============================================================================
// GraphPage Component
// ============================================================================

/**
 * Full-screen graph page that visualizes the workflow DAG with live status
 * updates. A status bar at the top shows workflow status, per-state node
 * counts, and total cost. Clicking a node navigates to the node detail page.
 *
 * During Phase 1 (spec), a planning header and spec artifact status panel
 * replace the normal status bar. The graph forms incrementally as nodes and
 * edges arrive via WebSocket events, with enter animations.
 *
 * Reads projectId from URL params and fetches workflow state through
 * useWorkflow, which combines REST polling with WebSocket events.
 *
 * @returns Rendered graph page filling the parent container.
 */
export const GraphPage = memo(function GraphPage(): ReactElement {
  const navigate = useNavigate();
  const projectId = useProjectId();
  const { workflow, nodes, loading, error } = useWorkflow(projectId);

  const isSpecPhase = workflow?.status === "spec";

  const { artifacts, wsNodes, wsEdges } = useSpecPhase(projectId, isSpecPhase);

  /** Navigate to the node detail page when a graph node is clicked. */
  const handleNodeClick = useCallback(
    (nodeId: string): void => {
      void navigate(`/projects/${encodeURIComponent(projectId)}/node/${encodeURIComponent(nodeId)}`);
    },
    [navigate, projectId],
  );

  /**
   * Build full Node[] from the workflow graph, overlaying live status
   * from the WebSocket-updated Node array. During spec phase,
   * merges in incrementally received WS nodes (deduplicated by ID).
   */
  const graphNodes = useMemo((): Node[] => {
    if (!workflow) return [];
    const statusMap = new Map<string, NodeStatus>(nodes.map((n) => [n.id, n.status]));
    const restNodes = Object.values(workflow.graph.nodes).map(
      (node): Node => ({
        ...node,
        status: statusMap.get(node.id) ?? node.status,
      }),
    );

    if (!isSpecPhase || wsNodes.length === 0) return restNodes;

    const existingIds = new Set(restNodes.map((n) => n.id));
    const newNodes = wsNodes.filter((n) => !existingIds.has(n.id));
    return [...restNodes, ...newNodes];
  }, [workflow, nodes, isSpecPhase, wsNodes]);

  /**
   * Extract edges from the workflow graph. During spec phase, merges in
   * incrementally received WS edges (deduplicated by from+to).
   */
  const graphEdges = useMemo((): Edge[] => {
    const restEdges = workflow?.graph.edges ?? [];

    if (!isSpecPhase || wsEdges.length === 0) return restEdges;

    const existingKeys = new Set(restEdges.map((e) => `${e.from}->${e.to}`));
    const newEdges = wsEdges.filter((e) => !existingKeys.has(`${e.from}->${e.to}`));
    return [...restEdges, ...newEdges];
  }, [workflow, isSpecPhase, wsEdges]);

  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
          <p className="text-sm text-gray-400">Loading workflow&hellip;</p>
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
          <p className="text-lg font-medium text-gray-300">No active workflow</p>
          <p className="mt-1 text-sm text-gray-500">
            Initialize a workflow to see the execution graph.
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Graph view with status bar (or planning header during spec phase)
  // --------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {isSpecPhase ? (
        <>
          <PlanningHeader />
          <SpecArtifactPanel artifacts={artifacts} />
        </>
      ) : (
        <StatusBar workflowStatus={workflow.status} nodes={nodes} totalCost={workflow.totalCost} />
      )}
      <div className="min-h-0 flex-1">
        <GraphView
          nodes={graphNodes}
          edges={graphEdges}
          onNodeClick={handleNodeClick}
          animate={isSpecPhase}
        />
      </div>
    </div>
  );
});
