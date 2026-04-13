// ============================================================================
// ReviewReport Component
//
// Displays a structured Loomex review report with a verdict badge,
// task verification checklist, detailed findings, and recommendation.
// Designed for the dark-themed dashboard.
// ============================================================================

import { memo } from "react";
import type { ReactElement } from "react";

import type {
  ReviewReport as ReviewReportData,
  ReviewVerdict,
  TaskVerificationStatus,
} from "../lib/types.js";

// ============================================================================
// Types
// ============================================================================

/** Props for the {@link ReviewReport} component. */
export interface ReviewReportProps {
  /** The review report to display, or null/undefined for a placeholder. */
  report: ReviewReportData | null | undefined;
}

// ============================================================================
// Constants
// ============================================================================

/** Verdict-to-Tailwind class mapping for the large verdict badge. */
const VERDICT_STYLES: Record<ReviewVerdict, { bg: string; text: string; border: string }> = {
  PASS: { bg: "bg-green-900", text: "text-green-300", border: "border-green-700" },
  FAIL: { bg: "bg-red-900", text: "text-red-300", border: "border-red-700" },
  BLOCKED: { bg: "bg-orange-900", text: "text-orange-300", border: "border-orange-700" },
};

/** Task verification status to icon and color mapping. */
const TASK_STATUS_DISPLAY: Record<TaskVerificationStatus, { icon: string; color: string }> = {
  pass: { icon: "\u2713", color: "text-green-400" },
  fail: { icon: "\u2717", color: "text-red-400" },
  blocked: { icon: "\u2298", color: "text-orange-400" },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format an ISO 8601 timestamp into a human-readable date-time string.
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

// ============================================================================
// ReviewReport Component
// ============================================================================

/**
 * Displays a structured Loomex review report.
 *
 * Renders a large verdict badge (PASS/FAIL/BLOCKED), a checklist of
 * per-task verification results with status icons, a detailed findings
 * paragraph, and a visually distinct recommendation section. Shows a
 * placeholder when no report data is available.
 *
 * @param props - Review report data.
 * @returns Rendered review report element.
 */
export const ReviewReport = memo(function ReviewReport({
  report,
}: ReviewReportProps): ReactElement {
  if (!report) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-6 text-center text-sm text-gray-500">
        No review report available.
      </div>
    );
  }

  const verdict = VERDICT_STYLES[report.verdict];

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 shadow-md">
      {/* Verdict badge */}
      <div className="border-b border-gray-700 px-4 py-4">
        <span
          className={`inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-bold tracking-wide ${verdict.bg} ${verdict.text} ${verdict.border}`}
        >
          {report.verdict}
        </span>
        <span className="ml-3 text-xs text-gray-500">{formatTimestamp(report.createdAt)}</span>
      </div>

      {/* Task checklist */}
      {report.tasksVerified.length > 0 && (
        <div className="border-b border-gray-700 px-4 py-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Task Verification
          </h4>
          <ul className="space-y-1.5">
            {report.tasksVerified.map((task) => {
              const display = TASK_STATUS_DISPLAY[task.status];
              return (
                <li key={task.taskId} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 font-mono font-bold ${display.color}`}>
                    {display.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-gray-200">{task.taskId}</span>
                    {task.details && <p className="mt-0.5 text-xs text-gray-400">{task.details}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Details */}
      {report.details && (
        <div className="border-b border-gray-700 px-4 py-3">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Details
          </h4>
          <p className="text-sm leading-relaxed text-gray-300">{report.details}</p>
        </div>
      )}

      {/* Recommendation */}
      {report.recommendation && (
        <div className="px-4 py-3">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Recommendation
          </h4>
          <p className="rounded border border-blue-800 bg-blue-950 px-3 py-2 text-sm leading-relaxed text-blue-200">
            {report.recommendation}
          </p>
        </div>
      )}
    </div>
  );
});
