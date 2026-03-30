import type { FastifyPluginAsync } from "fastify";
import type { WorkflowStatus } from "../../types.js";

// ============================================================================
// Types
// ============================================================================

/** Lightweight workflow summary returned by the health endpoint. */
export interface WorkflowSummary {
  /** Workflow identifier. */
  id: string;
  /** Current workflow lifecycle state. */
  status: WorkflowStatus;
  /** Total number of nodes in the execution graph. */
  nodeCount: number;
  /** IDs of nodes currently in "running" state. */
  activeNodes: string[];
}

/** Shape of the GET /health JSON response. */
export interface HealthResponse {
  /** Daemon status indicator. */
  status: "ok";
  /** Seconds since the daemon process started. */
  uptime: number;
  /** Daemon version string. */
  version: string;
  /** Active workflow summary, or null when no workflow is loaded. */
  workflow: WorkflowSummary | null;
}

/** Options accepted by the {@link healthRoutes} factory. */
export interface HealthRoutesOptions {
  /** Return the number of seconds since the daemon started. */
  getUptime: () => number;
  /** Return a summary of the active workflow, or null if none exists. */
  getWorkflow: () => WorkflowSummary | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Daemon version reported in the health response. */
const VERSION = "0.1.0";

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers `GET /health`.
 *
 * The route is unauthenticated (the server's `onRequest` hook bypasses
 * auth for this path). It returns daemon uptime, version, and an optional
 * workflow summary.
 *
 * @param options - Callbacks that supply runtime data for the response.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function healthRoutes(options: HealthRoutesOptions): FastifyPluginAsync {
  const { getUptime, getWorkflow } = options;

  const plugin: FastifyPluginAsync = (fastify): Promise<void> => {
    fastify.get("/health", (): HealthResponse => {
      return {
        status: "ok",
        uptime: getUptime(),
        version: VERSION,
        workflow: getWorkflow(),
      };
    });
    return Promise.resolve();
  };

  return plugin;
}
