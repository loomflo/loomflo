import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { CostSummary } from "../../costs/tracker.js";
import type { Workflow } from "../../types.js";
import type { ProjectRuntime } from "../../daemon-types.js";

// ============================================================================
// Types
// ============================================================================

/** Options accepted by the {@link costsRoutes} factory. */
export interface CostsRoutesOptions {
  /** Return the current aggregated cost summary from the tracker. */
  getCostSummary?: () => CostSummary;
  /** Return the current active workflow, or null if none exists. */
  getWorkflow?: () => Workflow | null;
  /** Return the cost in USD attributed to the Loom architect agent. */
  getLoomCost?: () => number;
}

/** Per-node cost entry in the GET /costs response. */
interface CostNodeEntry {
  /** Unique node identifier. */
  id: string;
  /** Human-readable node name. */
  title: string;
  /** Accumulated cost in USD for this node. */
  cost: number;
  /** Number of retry cycles attempted. */
  retries: number;
}

/** Shape of the GET /costs JSON response. */
interface CostsResponse {
  /** Total accumulated cost in USD across all nodes and Loom overhead. */
  total: number;
  /** Configured budget limit in USD, or null if none set. */
  budgetLimit: number | null;
  /** Remaining budget in USD, or null if no limit is set. */
  budgetRemaining: number | null;
  /** Per-node cost breakdown with titles and retry counts. */
  nodes: CostNodeEntry[];
  /** Cost in USD attributed to the Loom architect agent. */
  loomCost: number;
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers cost routes.
 *
 * - GET /costs — return per-node costs, total, budget remaining, and Loom overhead.
 *
 * @param options - Callbacks that supply runtime cost and workflow data.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function costsRoutes(options: CostsRoutesOptions): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = (fastify): Promise<void> => {
    /**
     * GET /costs
     *
     * Returns the aggregated cost breakdown for the active workflow,
     * including per-node costs, total cost, budget info, and Loom overhead.
     * Returns 404 if no workflow is active.
     */
    fastify.get("/costs", async (request, reply): Promise<void> => {
      const rt = (request as FastifyRequest & { runtime?: ProjectRuntime }).runtime;

      const workflow: Workflow | null = rt ? rt.workflow : (options.getWorkflow?.() ?? null);

      if (workflow === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }

      const summary: CostSummary = rt
        ? rt.costTracker.getSummary()
        : (options.getCostSummary?.() ?? { totalCost: 0, perNode: {}, perAgent: {}, budgetLimit: null, budgetRemaining: null, entries: [] });

      const loomCost: number = rt ? 0 : (options.getLoomCost?.() ?? 0);

      const nodes: CostNodeEntry[] = Object.values(workflow.graph.nodes).map((node) => ({
        id: node.id,
        title: node.title,
        cost: summary.perNode[node.id] ?? 0,
        retries: node.retryCount,
      }));

      const response: CostsResponse = {
        total: summary.totalCost,
        budgetLimit: summary.budgetLimit,
        budgetRemaining: summary.budgetRemaining,
        nodes,
        loomCost,
      };

      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };

  return plugin;
}
