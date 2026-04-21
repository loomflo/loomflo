// packages/cli/src/workflow-init.ts
//
// Shared helper that seeds a workflow on an existing loomflo project.
// Used by both `loomflo init` (end-of-onboarding auto-kick) and the
// top-level `loomflo workflow init <description>` command.
//
// Flow:
//   1. POST /projects/:id/workflow/init  (201 created, background spec gen)
//   2. Poll GET /projects/:id/workflow every POLL_INTERVAL_MS until the
//      workflow transitions out of "spec" (i.e. to "building" or "failed").
//   3. Return a structured result; surface the daemon error on failure.
//
// The caller owns the UI (spinner, log lines, JSON emission).

import type { DaemonInfo } from "./daemon-control.js";

// ============================================================================
// Constants
// ============================================================================

/** Interval in milliseconds between GET /workflow polls. */
export const POLL_INTERVAL_MS = 2000;

/** Upper bound on total wait time before giving up (spec gen can be long). */
export const POLL_TIMEOUT_MS = 10 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

/** Subset of the workflow graph shape the CLI cares about. */
export interface WorkflowGraphSummary {
  nodes: Record<string, unknown>;
  edges: unknown[];
  topology?: string;
}

/** Shape returned by GET /projects/:id/workflow. */
export interface WorkflowState {
  id: string;
  status: string;
  description: string;
  graph: WorkflowGraphSummary;
}

/** Shape returned by POST /projects/:id/workflow/init (201). */
export interface WorkflowInitResponse {
  id: string;
  status: string;
  description: string;
}

/** Result of a successful `runWorkflowInit` call. */
export interface WorkflowInitResult {
  /** The workflow id created by the daemon. */
  id: string;
  /** Terminal status reached by the poll loop ("building" or "failed"). */
  status: string;
  /** Number of nodes in the generated graph (0 on failure). */
  nodeCount: number;
}

/** Dependencies injected into the helper for testability. */
export interface WorkflowInitDeps {
  /** POST the workflow init request. Returns the created workflow stub. */
  postInit: (
    info: DaemonInfo,
    projectId: string,
    body: { description: string; projectPath: string },
  ) => Promise<WorkflowInitResponse>;
  /** GET the current workflow state. Returns null when no active workflow. */
  getWorkflow: (info: DaemonInfo, projectId: string) => Promise<WorkflowState | null>;
  /** Sleep helper (overridable for fake-timer tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Override the poll interval (ms). Defaults to POLL_INTERVAL_MS. */
  pollIntervalMs?: number;
  /** Override the total timeout (ms). Defaults to POLL_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Override the clock (ms since epoch). */
  now?: () => number;
}

/** Arguments to `runWorkflowInit`. */
export interface WorkflowInitArgs {
  info: DaemonInfo;
  projectId: string;
  projectPath: string;
  description: string;
}

// ============================================================================
// Default deps
// ============================================================================

/** Production dependency implementations backed by `fetch`. */
export function defaultWorkflowInitDeps(): WorkflowInitDeps {
  return {
    postInit: async (info, projectId, body) => {
      const res = await fetch(
        `http://127.0.0.1:${String(info.port)}/projects/${projectId}/workflow/init`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${info.token}`,
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          details?: unknown;
        };
        const code = err.error ?? `HTTP ${String(res.status)}`;
        const detail = err.message ?? (err.details ? JSON.stringify(err.details) : undefined);
        const message = detail ? `${code}: ${detail}` : code;
        // Preserve the HTTP status on the error so callers can distinguish 409.
        const e = new Error(message) as Error & { status?: number };
        e.status = res.status;
        throw e;
      }
      return (await res.json()) as WorkflowInitResponse;
    },
    getWorkflow: async (info, projectId) => {
      const res = await fetch(
        `http://127.0.0.1:${String(info.port)}/projects/${projectId}/workflow`,
        {
          headers: { authorization: `Bearer ${info.token}` },
        },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      return (await res.json()) as WorkflowState;
    },
  };
}

// ============================================================================
// Helper
// ============================================================================

/**
 * Seed a workflow and block until spec generation reaches a terminal
 * state (building or failed).
 *
 * @throws Error tagged with `code === "E_WORKFLOW_CONFLICT"` when the
 *   daemon returns 409 because a workflow already exists.
 * @throws Error tagged with `code === "E_WORKFLOW_TIMEOUT"` when the poll
 *   loop exceeds `timeoutMs`.
 * @throws Error tagged with `code === "E_WORKFLOW_FAILED"` when the
 *   daemon reports a failed workflow.
 */
export async function runWorkflowInit(
  args: WorkflowInitArgs,
  deps: WorkflowInitDeps = defaultWorkflowInitDeps(),
): Promise<WorkflowInitResult> {
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const pollInterval = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeout = deps.timeoutMs ?? POLL_TIMEOUT_MS;
  const now = deps.now ?? ((): number => Date.now());

  let created: WorkflowInitResponse;
  try {
    created = await deps.postInit(args.info, args.projectId, {
      description: args.description,
      projectPath: args.projectPath,
    });
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 409) {
      const tagged = new Error(
        err instanceof Error ? err.message : String(err),
      ) as Error & { code?: string };
      tagged.code = "E_WORKFLOW_CONFLICT";
      throw tagged;
    }
    throw err;
  }

  const deadline = now() + timeout;
  for (;;) {
    const state = await deps.getWorkflow(args.info, args.projectId);
    if (state !== null) {
      if (state.status === "failed") {
        const failed = new Error(`workflow ${state.id} failed during spec generation`) as Error & {
          code?: string;
        };
        failed.code = "E_WORKFLOW_FAILED";
        throw failed;
      }
      if (state.status !== "spec") {
        return {
          id: state.id,
          status: state.status,
          nodeCount: Object.keys(state.graph.nodes).length,
        };
      }
    }
    if (now() >= deadline) {
      const timedOut = new Error(
        `workflow ${created.id} did not finish spec generation within ${String(
          Math.round(timeout / 1000),
        )}s`,
      ) as Error & { code?: string };
      timedOut.code = "E_WORKFLOW_TIMEOUT";
      throw timedOut;
    }
    await sleep(pollInterval);
  }
}
