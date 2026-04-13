// ============================================================================
// AgentStatus Component
//
// Displays an individual agent's status: role icon, lifecycle state
// indicator with color coding, current task description, and token/cost
// metadata. Designed for the dark-themed dashboard.
// ============================================================================

import { memo } from "react";
import type { ReactElement } from "react";

import type { AgentRole, AgentStatus as AgentStatusType, TokenUsage } from "../lib/types.js";

// ============================================================================
// Types
// ============================================================================

/** Props for the {@link AgentStatusCard} component. */
export interface AgentStatusProps {
  /** Unique agent identifier (e.g., "looma-auth-1"). */
  id: string;
  /** Agent role in the workflow. */
  role: AgentRole;
  /** Current agent lifecycle state. */
  status: AgentStatusType;
  /** Description of the agent's assigned task. */
  taskDescription: string;
  /** Cumulative token usage for this agent's LLM calls. */
  tokenUsage: TokenUsage;
  /** Cumulative cost in USD for this agent's LLM calls. */
  cost: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum character length for the displayed task description. */
const TASK_DESCRIPTION_MAX_LENGTH = 120;

/** Role-to-icon mapping for visual identification. */
const ROLE_ICONS: Record<AgentRole, { icon: string; label: string }> = {
  loom: { icon: "\u{1F3D7}\u{FE0F}", label: "Architect" },
  loomi: { icon: "\u{1F3AF}", label: "Orchestrator" },
  looma: { icon: "\u{2699}\u{FE0F}", label: "Worker" },
  loomex: { icon: "\u{1F50D}", label: "Reviewer" },
};

/** Status-to-Tailwind class mapping for the color-coded state indicator. */
const STATUS_STYLES: Record<AgentStatusType, { bg: string; text: string; dot: string }> = {
  created: { bg: "bg-gray-700", text: "text-gray-300", dot: "bg-gray-400" },
  running: { bg: "bg-blue-900", text: "text-blue-300", dot: "bg-blue-400" },
  completed: { bg: "bg-green-900", text: "text-green-300", dot: "bg-green-400" },
  failed: { bg: "bg-red-900", text: "text-red-300", dot: "bg-red-400" },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a numeric USD value as a currency string (e.g., `$0.0032`).
 *
 * Uses up to four decimal places to preserve precision for small LLM costs.
 *
 * @param value - Cost in USD.
 * @returns Formatted currency string.
 */
function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * Format a token count with a `k` suffix for thousands (e.g., `12.3k`).
 *
 * Values under 1 000 are returned as-is.
 *
 * @param count - Raw token count.
 * @returns Human-readable token string.
 */
function formatTokens(count: number): string {
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
}

/**
 * Truncate a string to the given maximum length, appending an ellipsis.
 *
 * @param text - Source string.
 * @param maxLength - Maximum character count before truncation.
 * @returns Truncated (or original) string.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

// ============================================================================
// AgentStatusCard Component
// ============================================================================

/**
 * Displays an individual agent's current status.
 *
 * Shows a role-specific icon, a color-coded lifecycle state badge with
 * a pulsing dot for the `running` state, the agent's task description
 * (truncated when long), and token usage / cost metadata.
 *
 * @param props - Agent status data.
 * @returns Rendered agent status element.
 */
export const AgentStatusCard = memo(function AgentStatusCard({
  id,
  role,
  status,
  taskDescription,
  tokenUsage,
  cost,
}: AgentStatusProps): ReactElement {
  const roleInfo = ROLE_ICONS[role];
  const statusStyle = STATUS_STYLES[status];

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 shadow-md">
      {/* Header: role icon + agent ID + status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="text-base" role="img" aria-label={roleInfo.label}>
            {roleInfo.icon}
          </span>
          <span className="truncate text-sm font-medium text-gray-100">{id}</span>
        </div>

        {/* Status badge */}
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}${
              status === "running" ? " animate-pulse" : ""
            }`}
          />
          {status}
        </span>
      </div>

      {/* Role label */}
      <div className="mt-1 text-xs text-gray-500">{roleInfo.label}</div>

      {/* Task description */}
      {taskDescription && (
        <p className="mt-2 text-xs leading-relaxed text-gray-300">
          {truncate(taskDescription, TASK_DESCRIPTION_MAX_LENGTH)}
        </p>
      )}

      {/* Token usage + cost metadata */}
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
        <span title="Input tokens">{formatTokens(tokenUsage.input)} in</span>
        <span title="Output tokens">{formatTokens(tokenUsage.output)} out</span>
        <span title="Accumulated cost">{formatUsd(cost)}</span>
      </div>
    </div>
  );
});
