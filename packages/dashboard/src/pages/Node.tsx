// ============================================================================
// Node Detail Page
//
// Displays detailed information for a single workflow node: status, agents,
// file ownership, event log stream, review report, retry count, and cost.
// Subscribes to WebSocket events for real-time updates filtered by node ID.
// ============================================================================

import { memo, useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import type {
  AgentRole,
  AgentStatus as AgentStatusType,
  Event,
  NodeStatus,
  ReviewReport as ReviewReportData,
} from "../lib/types.js";
import type { NodeDetailResponse } from "../lib/api.js";
import { apiClient, ApiError } from "../lib/api.js";
import { AgentStatusCard } from "../components/AgentStatus.js";
import { LogStream } from "../components/LogStream.js";
import { ReviewReport } from "../components/ReviewReport.js";
import { useWebSocket } from "../hooks/useWebSocket.js";

// ============================================================================
// Constants
// ============================================================================

/** Node status to Tailwind class mapping for the color-coded status badge. */
const NODE_STATUS_STYLES: Record<NodeStatus, { bg: string; text: string; dot: string }> = {
  pending: { bg: "bg-gray-700", text: "text-gray-300", dot: "bg-gray-400" },
  waiting: { bg: "bg-amber-900", text: "text-amber-300", dot: "bg-amber-400" },
  running: { bg: "bg-blue-900", text: "text-blue-300", dot: "bg-blue-400" },
  review: { bg: "bg-purple-900", text: "text-purple-300", dot: "bg-purple-400" },
  done: { bg: "bg-green-900", text: "text-green-300", dot: "bg-green-400" },
  failed: { bg: "bg-red-900", text: "text-red-300", dot: "bg-red-400" },
  blocked: { bg: "bg-orange-900", text: "text-orange-300", dot: "bg-orange-400" },
};

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

// ============================================================================
// NodePage Component
// ============================================================================

/**
 * Node detail page displaying comprehensive information for a single
 * workflow node. Shows node title, color-coded status badge, delay,
 * started time, retry count, cost, agent list via {@link AgentStatusCard},
 * file ownership table, event log via {@link LogStream}, and review report
 * via {@link ReviewReport}.
 *
 * Reads the node ID from URL params and the auth token from the `?token=`
 * query parameter. Subscribes to WebSocket events (`agent_status`,
 * `node_status`, `cost_update`, `review_verdict`) filtered by the
 * current node ID for real-time updates.
 *
 * @returns Rendered node detail page element.
 */
export const NodePage = memo(function NodePage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const { subscribe } = useWebSocket(token);

  const [node, setNode] = useState<NodeDetailResponse | null>(null);
  const [review, setReview] = useState<ReviewReportData | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // Refetch callbacks (used by WS handlers — no loading state change)
  // --------------------------------------------------------------------------

  /**
   * Refetch node detail from the REST API.
   * Silently ignores errors to avoid disrupting the UI on transient failures.
   */
  const refetchNode = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const data = await apiClient.getNode(id);
      setNode(data);
    } catch {
      // Silently ignore refetch errors
    }
  }, [id]);

  /**
   * Refetch review report from the REST API.
   * A 404 is expected when no review exists yet and is silently ignored.
   */
  const refetchReview = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const data = await apiClient.getNodeReview(id);
      setReview(data);
    } catch {
      // 404 is expected when no review exists
    }
  }, [id]);

  /**
   * Refetch events filtered by node ID from the REST API.
   * Silently ignores errors to avoid disrupting the log stream display.
   */
  const refetchEvents = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const data = await apiClient.getEvents({ nodeId: id });
      setEvents(data.events);
    } catch {
      // Silently ignore refetch errors
    }
  }, [id]);

  // --------------------------------------------------------------------------
  // Initial data load
  // --------------------------------------------------------------------------

  useEffect((): void => {
    if (!id) return;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      const [nodeResult, reviewResult, eventsResult] = await Promise.allSettled([
        apiClient.getNode(id),
        apiClient.getNodeReview(id),
        apiClient.getEvents({ nodeId: id }),
      ]);

      if (nodeResult.status === "fulfilled") {
        setNode(nodeResult.value);
      } else {
        const reason = nodeResult.reason as unknown;
        if (reason instanceof ApiError && reason.status === 404) {
          setError("Node not found");
        } else {
          setError(reason instanceof Error ? reason.message : "Failed to fetch node");
        }
      }

      if (reviewResult.status === "fulfilled") {
        setReview(reviewResult.value);
      }

      if (eventsResult.status === "fulfilled") {
        setEvents(eventsResult.value.events);
      }

      setLoading(false);
    };

    void load();
  }, [id]);

  // --------------------------------------------------------------------------
  // WebSocket subscriptions
  // --------------------------------------------------------------------------

  useEffect((): (() => void) => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      subscribe("node_status", (event): void => {
        if (event.nodeId === id) {
          void refetchNode();
          void refetchEvents();
          if (event.status === "review" || event.status === "done") {
            void refetchReview();
          }
        }
      }),
    );

    unsubs.push(
      subscribe("agent_status", (event): void => {
        if (event.nodeId === id) {
          void refetchNode();
          void refetchEvents();
        }
      }),
    );

    unsubs.push(
      subscribe("cost_update", (event): void => {
        if (event.nodeId === id) {
          void refetchNode();
        }
      }),
    );

    unsubs.push(
      subscribe("review_verdict", (event): void => {
        if (event.nodeId === id) {
          void refetchReview();
          void refetchEvents();
        }
      }),
    );

    return (): void => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [id, subscribe, refetchNode, refetchReview, refetchEvents]);

  // --------------------------------------------------------------------------
  // Derived values
  // --------------------------------------------------------------------------

  const backUrl = token ? `/graph?token=${encodeURIComponent(token)}` : "/graph";

  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
          <p className="text-sm text-gray-400">Loading node…</p>
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
        <div className="text-center">
          <p className="text-sm text-red-400">{error}</p>
          <Link
            to={backUrl}
            className="mt-3 inline-block text-sm text-blue-400 hover:text-blue-300"
          >
            Back to Graph
          </Link>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-300">Node not found</p>
          <Link
            to={backUrl}
            className="mt-3 inline-block text-sm text-blue-400 hover:text-blue-300"
          >
            Back to Graph
          </Link>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Loaded state
  // --------------------------------------------------------------------------

  const statusStyle = NODE_STATUS_STYLES[node.status];
  const ownershipEntries = Object.entries(node.fileOwnership);

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div>
        <Link to={backUrl} className="text-sm text-blue-400 hover:text-blue-300">
          &larr; Back to Graph
        </Link>

        <div className="mt-3 flex items-center gap-4">
          <h2 className="text-2xl font-semibold text-gray-100">{node.title}</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}${
                node.status === "running" ? " animate-pulse" : ""
              }`}
            />
            {node.status}
          </span>
        </div>

        <p className="mt-1 text-xs text-gray-500">ID: {node.id}</p>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-gray-500">Started</span>
          <p className="mt-1 text-sm text-gray-200">
            {node.startedAt ? formatTimestamp(node.startedAt) : "\u2014"}
          </p>
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-gray-500">Delay</span>
          <p className="mt-1 text-sm text-gray-200">{node.delay || "0"}</p>
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-gray-500">Retries</span>
          <p className="mt-1 text-sm text-gray-200">
            {node.retryCount} / {node.maxRetries}
          </p>
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-gray-500">Cost</span>
          <p className="mt-1 text-sm text-gray-200">{formatUsd(node.cost)}</p>
        </div>
      </div>

      {/* Agents */}
      {node.agents.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
            Agents ({node.agents.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {node.agents.map((agent) => (
              <AgentStatusCard
                key={agent.id}
                id={agent.id}
                role={agent.role as AgentRole}
                status={agent.status as AgentStatusType}
                taskDescription={agent.taskDescription}
                tokenUsage={agent.tokenUsage}
                cost={agent.cost}
              />
            ))}
          </div>
        </div>
      )}

      {/* File Ownership */}
      {ownershipEntries.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
            File Ownership
          </h3>
          <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Agent
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Write Scope
                  </th>
                </tr>
              </thead>
              <tbody>
                {ownershipEntries.map(([agentId, patterns]) => (
                  <tr key={agentId} className="border-b border-gray-800 last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-gray-200">
                      {agentId}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {patterns.map((pattern) => (
                          <code
                            key={pattern}
                            className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300"
                          >
                            {pattern}
                          </code>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log Stream */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Event Log
        </h3>
        <div className="h-80">
          <LogStream events={events} />
        </div>
      </div>

      {/* Review Report */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Review Report
        </h3>
        <ReviewReport report={review} />
      </div>
    </div>
  );
});
