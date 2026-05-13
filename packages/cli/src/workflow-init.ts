// packages/cli/src/workflow-init.ts
//
// Shared helpers that seed a workflow on an existing loomflo project.
// Used by `loomflo init` (end-of-onboarding auto-kick, fire-and-forget),
// `loomflo workflow init <description>` (one-shot), and
// `loomflo workflow watch` (follow an already-kicked spec).
//
// The flow is split into two phases so callers can choose whether to
// block until completion:
//
//   1. kickoffWorkflowInit()   — POST /projects/:id/workflow/init,
//                                 returns immediately with the stub
//                                 response (201). 409 becomes
//                                 E_WORKFLOW_CONFLICT.
//   2. pollWorkflowSpec()       — GET /projects/:id/workflow every
//                                 POLL_INTERVAL_MS until the workflow
//                                 transitions out of "spec". Honours
//                                 `timeoutMs` (0 = no deadline).
//
// `runWorkflowInit()` is a thin kickoff+poll wrapper kept for callers
// (and existing tests) that want both phases in one await.
//
// The caller owns the UI (spinner, log lines, JSON emission).

import type { DaemonInfo } from "./daemon-control.js";

// ============================================================================
// Constants
// ============================================================================

/** Interval in milliseconds between GET /workflow polls. */
export const POLL_INTERVAL_MS = 2000;

/**
 * Default poll timeout. Following the same convention as the per-node
 * budget, `0` means "no deadline — poll until the daemon reaches a
 * terminal state or the user Ctrl-C's". Spec generation can legitimately
 * take 10+ minutes for complex workflows; a hard 10-minute wall caused
 * real user runs to be killed mid-spec.
 */
export const POLL_TIMEOUT_MS = 0;

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
  /**
   * Override the total timeout (ms). Defaults to POLL_TIMEOUT_MS.
   * Pass `0` for no deadline — the loop will poll until the workflow
   * reaches a terminal state.
   */
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
 * Fire the `POST /projects/:id/workflow/init` request and return the
 * stub response. Does not poll — the caller can return to the shell
 * and use `pollWorkflowSpec()` (or `loomflo workflow watch`) later.
 *
 * @throws Error tagged with `code === "E_WORKFLOW_CONFLICT"` when the
 *   daemon returns 409 because a workflow already exists.
 */
export async function kickoffWorkflowInit(
  args: WorkflowInitArgs,
  deps: Pick<WorkflowInitDeps, "postInit"> = defaultWorkflowInitDeps(),
): Promise<WorkflowInitResponse> {
  try {
    return await deps.postInit(args.info, args.projectId, {
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
}

/** Arguments to `pollWorkflowSpec`. */
export interface PollWorkflowSpecArgs {
  info: DaemonInfo;
  projectId: string;
  /**
   * Id of the workflow being watched. Used in the timeout error
   * message; the poll loop itself reads the current workflow state
   * from the daemon and ignores this id.
   */
  workflowId: string;
}

/**
 * Poll `GET /projects/:id/workflow` until the workflow transitions
 * out of "spec" (to "building" or "failed").
 *
 * @throws Error tagged with `code === "E_WORKFLOW_TIMEOUT"` when the
 *   poll loop exceeds `timeoutMs` (and `timeoutMs > 0`).
 * @throws Error tagged with `code === "E_WORKFLOW_FAILED"` when the
 *   daemon reports a failed workflow.
 */
export async function pollWorkflowSpec(
  args: PollWorkflowSpecArgs,
  deps: Pick<
    WorkflowInitDeps,
    "getWorkflow" | "sleep" | "pollIntervalMs" | "timeoutMs" | "now"
  > = defaultWorkflowInitDeps(),
): Promise<WorkflowInitResult> {
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const pollInterval = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeout = deps.timeoutMs ?? POLL_TIMEOUT_MS;
  const now = deps.now ?? ((): number => Date.now());

  // `timeout === 0` means "no deadline" — match the per-node budget
  // convention elsewhere in the CLI.
  const hasDeadline = timeout > 0;
  const deadline = hasDeadline ? now() + timeout : 0;
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
    if (hasDeadline && now() >= deadline) {
      const timedOut = new Error(
        `workflow ${args.workflowId} did not finish spec generation within ${String(
          Math.round(timeout / 1000),
        )}s`,
      ) as Error & { code?: string };
      timedOut.code = "E_WORKFLOW_TIMEOUT";
      throw timedOut;
    }
    await sleep(pollInterval);
  }
}

/**
 * Seed a workflow and block until spec generation reaches a terminal
 * state. Thin wrapper over `kickoffWorkflowInit` + `pollWorkflowSpec`
 * kept so callers that want both phases in one await don't have to
 * stitch the two halves themselves.
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
  const created = await kickoffWorkflowInit(args, deps);
  return pollWorkflowSpec(
    { info: args.info, projectId: args.projectId, workflowId: created.id },
    deps,
  );
}
