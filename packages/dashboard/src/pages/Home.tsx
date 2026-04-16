// ============================================================================
// Home Page
//
// Overview dashboard showing workflow status, active nodes summary,
// cost summary with budget progress, and recent events.
// ============================================================================

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useParams } from "react-router-dom";

import type { Event, Node, NodeStatus } from "../lib/types.js";
import type { CostSummary } from "../lib/types.js";
import { useProject } from "../context/ProjectContext.js";
import { LogStream } from "../components/LogStream.js";
import { useWebSocket } from "../hooks/useWebSocket.js";
import { useWorkflow } from "../hooks/useWorkflow.js";

// ============================================================================
// Constants
// ============================================================================

/** Node status to Tailwind class mapping for color-coded badges. */
const NODE_STATUS_STYLES: Record<NodeStatus, { bg: string; text: string; dot: string }> = {
  pending: { bg: "bg-gray-700", text: "text-gray-300", dot: "bg-gray-400" },
  waiting: { bg: "bg-amber-900", text: "text-amber-300", dot: "bg-amber-400" },
  running: { bg: "bg-blue-900", text: "text-blue-300", dot: "bg-blue-400" },
  review: { bg: "bg-purple-900", text: "text-purple-300", dot: "bg-purple-400" },
  done: { bg: "bg-green-900", text: "text-green-300", dot: "bg-green-400" },
  failed: { bg: "bg-red-900", text: "text-red-300", dot: "bg-red-400" },
  blocked: { bg: "bg-orange-900", text: "text-orange-300", dot: "bg-orange-400" },
};

/** Workflow status to Tailwind class mapping. */
const WORKFLOW_STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  init: { bg: "bg-gray-700", text: "text-gray-300", dot: "bg-gray-400" },
  spec: { bg: "bg-purple-900", text: "text-purple-300", dot: "bg-purple-400" },
  building: { bg: "bg-cyan-900", text: "text-cyan-300", dot: "bg-cyan-400" },
  running: { bg: "bg-blue-900", text: "text-blue-300", dot: "bg-blue-400" },
  paused: { bg: "bg-amber-900", text: "text-amber-300", dot: "bg-amber-400" },
  done: { bg: "bg-green-900", text: "text-green-300", dot: "bg-green-400" },
  failed: { bg: "bg-red-900", text: "text-red-300", dot: "bg-red-400" },
};

/** All node statuses displayed in the summary. */
const ALL_NODE_STATUSES: readonly { key: NodeStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "waiting", label: "Waiting" },
  { key: "running", label: "Running" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
  { key: "blocked", label: "Blocked" },
] as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format an ISO 8601 timestamp as a human-readable date-time string.
 *
 * @param iso - ISO 8601 timestamp string.
 * @returns Formatted date-time string (e.g., "Mar 24, 2026, 3:42 PM").
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a numeric USD value as a currency string with four decimal places.
 *
 * @param value - Cost in USD.
 * @returns Formatted currency string (e.g., "$0.1800").
 */
function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * Compute per-status node counts from a list of nodes.
 *
 * @param nodes - Nodes to count.
 * @returns Map of node status to count.
 */
function computeNodeCounts(nodes: readonly Node[]): Map<NodeStatus, number> {
  const map = new Map<NodeStatus, number>();
  for (const node of nodes) {
    map.set(node.status, (map.get(node.status) ?? 0) + 1);
  }
  return map;
}

// ============================================================================
// HomePage Component
// ============================================================================

/**
 * Home/overview page displaying workflow status, active nodes summary,
 * cost summary with budget progress bar, and the most recent events.
 *
 * Reads projectId from URL params via useParams(). Connects to the Loomflo
 * daemon via useWebSocket and fetches workflow state through useWorkflow.
 *
 * @returns Rendered home page element.
 */
export const HomePage = memo(function HomePage(): ReactElement | null {
  const { projectId } = useParams<{ projectId: string }>();
  if (projectId === undefined) return null;
  const { client, baseUrl, token } = useProject();

  const { workflow, nodes, loading, error } = useWorkflow(projectId);

  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [events, setEvents] = useState<Event[]>([]);

  // --------------------------------------------------------------------------
  // Data fetching
  // --------------------------------------------------------------------------

  /** Fetch costs from the REST API. */
  const refetchCosts = useCallback(async (): Promise<void> => {
    try {
      const data = await client.getCosts(projectId);
      setCosts(data);
    } catch {
      // Silently ignore -- costs card will show workflow.totalCost fallback
    }
  }, [client, projectId]);

  /** Fetch recent events from the REST API. */
  const refetchEvents = useCallback(async (): Promise<void> => {
    try {
      const data = await client.getEvents(projectId, { limit: 20 });
      setEvents(data);
    } catch {
      // Silently ignore -- events section will show empty state
    }
  }, [client, projectId]);

  // --------------------------------------------------------------------------
  // Initial data load
  // --------------------------------------------------------------------------

  useEffect((): void => {
    void refetchCosts();
    void refetchEvents();
  }, [refetchCosts, refetchEvents]);

  // --------------------------------------------------------------------------
  // WebSocket subscriptions
  // --------------------------------------------------------------------------

  useWebSocket({
    baseUrl,
    token,
    subscribe: { projectIds: [projectId] },
    onMessage: (frame): void => {
      const type = frame["type"] as string | undefined;

      if (type === "workflow_status" || type === "node_status") {
        void refetchEvents();
      }

      if (type === "cost_update") {
        void refetchCosts();
        void refetchEvents();
      }
    },
  });

  // --------------------------------------------------------------------------
  // Derived values
  // --------------------------------------------------------------------------

  const nodeCounts = useMemo(() => computeNodeCounts(nodes), [nodes]);

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
          <p className="text-lg font-medium text-gray-300">No active workflow</p>
          <p className="mt-2 text-sm text-gray-500">
            Run{" "}
            <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300">
              loomflo init
            </code>{" "}
            to create a workflow and start building.
          </p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Loaded state
  // --------------------------------------------------------------------------

  const workflowStyle = WORKFLOW_STATUS_STYLES[workflow.status] ?? {
    bg: "bg-gray-700",
    text: "text-gray-300",
    dot: "bg-gray-400",
  };

  const totalCost = costs?.totalCost ?? workflow.totalCost;
  const budgetLimit = workflow.config.budgetLimit;
  const budgetUsedPercent =
    budgetLimit !== null && budgetLimit > 0 ? Math.min((totalCost / budgetLimit) * 100, 100) : null;

  return (
    <div className="space-y-6">
      {/* Workflow Status Card */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-5">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-gray-100">Workflow</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${workflowStyle.bg} ${workflowStyle.text}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${workflowStyle.dot}${
                workflow.status === "running" ? " animate-pulse" : ""
              }`}
            />
            {workflow.status}
          </span>
        </div>

        <p className="mt-1 text-xs text-gray-500">ID: {workflow.id}</p>

        {workflow.description && (
          <p className="mt-3 text-sm text-gray-300">{workflow.description}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <span className="text-xs uppercase tracking-wider text-gray-500">Created</span>
            <p className="mt-1 text-sm text-gray-200">{formatTimestamp(workflow.createdAt)}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-gray-500">Updated</span>
            <p className="mt-1 text-sm text-gray-200">{formatTimestamp(workflow.updatedAt)}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-gray-500">Total Nodes</span>
            <p className="mt-1 text-sm text-gray-200">{nodes.length}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-gray-500">Total Cost</span>
            <p className="mt-1 text-sm text-gray-200">{formatUsd(totalCost)}</p>
          </div>
        </div>
      </div>

      {/* Active Nodes Summary */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Nodes by Status
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {ALL_NODE_STATUSES.map(({ key, label }) => {
            const count = nodeCounts.get(key) ?? 0;
            const style = NODE_STATUS_STYLES[key];
            return (
              <div
                key={key}
                className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-center"
              >
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium ${style.text}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  {label}
                </span>
                <p className="mt-1 text-2xl font-semibold text-gray-100">{count}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cost Summary */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Cost Summary
        </h3>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-xs uppercase tracking-wider text-gray-500">Total Cost</span>
              <p className="mt-1 text-lg font-semibold text-gray-100">{formatUsd(totalCost)}</p>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider text-gray-500">Budget Limit</span>
              <p className="mt-1 text-lg font-semibold text-gray-100">
                {budgetLimit !== null ? formatUsd(budgetLimit) : "\u2014"}
              </p>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider text-gray-500">Remaining</span>
              <p className="mt-1 text-lg font-semibold text-gray-100">
                {budgetLimit !== null ? formatUsd(Math.max(0, budgetLimit - totalCost)) : "\u2014"}
              </p>
            </div>
          </div>

          {budgetUsedPercent !== null && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Budget used</span>
                <span>{budgetUsedPercent.toFixed(1)}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-700">
                <div
                  className={`h-full rounded-full transition-all ${
                    budgetUsedPercent >= 90
                      ? "bg-red-500"
                      : budgetUsedPercent >= 70
                        ? "bg-amber-500"
                        : "bg-blue-500"
                  }`}
                  style={{ width: `${String(budgetUsedPercent)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Events */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Recent Events
        </h3>
        <div className="h-80">
          <LogStream events={events} />
        </div>
      </div>
    </div>
  );
});
