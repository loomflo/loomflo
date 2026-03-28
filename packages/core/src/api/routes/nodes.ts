import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AgentInfo, Node, ReviewReport, Workflow } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

/** Options accepted by the {@link nodesRoutes} factory. */
export interface NodesRoutesOptions {
  /** Return the current active workflow, or null if none exists. */
  getWorkflow: () => Workflow | null;
}

/** Summary representation of a node for the list endpoint. */
interface NodeSummary {
  /** Unique node identifier. */
  id: string;
  /** Human-readable node name. */
  title: string;
  /** Current node execution state. */
  status: string;
  /** Total accumulated cost in USD. */
  cost: number;
  /** Number of agents assigned to the node. */
  agentCount: number;
  /** Number of retry cycles attempted. */
  retryCount: number;
  /** ISO 8601 timestamp when the node started running, or null. */
  startedAt: string | null;
  /** ISO 8601 timestamp when the node finished, or null. */
  completedAt: string | null;
}

/** Detailed representation of a node for the detail endpoint. */
interface NodeDetail {
  /** Unique node identifier. */
  id: string;
  /** Human-readable node name. */
  title: string;
  /** Current node execution state. */
  status: string;
  /** Markdown instructions for the node. */
  instructions: string;
  /** Delay before activation. */
  delay: string;
  /** ISO 8601 timestamp when the delay expires, or null. */
  resumeAt: string | null;
  /** Agents assigned to this node with full metadata. */
  agents: AgentInfo[];
  /** Agent ID to glob patterns mapping for write scope enforcement. */
  fileOwnership: Record<string, string[]>;
  /** Number of retry cycles attempted. */
  retryCount: number;
  /** Maximum allowed retry cycles. */
  maxRetries: number;
  /** Loomex review report, or null if no review has run. */
  reviewReport: ReviewReport | null;
  /** Total accumulated cost in USD. */
  cost: number;
  /** ISO 8601 timestamp when the node started running, or null. */
  startedAt: string | null;
  /** ISO 8601 timestamp when the node finished, or null. */
  completedAt: string | null;
}

// ============================================================================
// Request Schemas
// ============================================================================

/** Zod schema for the GET /nodes/:id route parameters. */
const NodeParamsSchema = z.object({
  id: z.string().min(1),
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map a {@link Node} to a {@link NodeSummary} for the list endpoint.
 *
 * @param node - The full node data.
 * @returns A summary object with key status and cost fields.
 */
function toNodeSummary(node: Node): NodeSummary {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    cost: node.cost,
    agentCount: node.agents.length,
    retryCount: node.retryCount,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
  };
}

/**
 * Map a {@link Node} to a {@link NodeDetail} for the detail endpoint.
 *
 * @param node - The full node data.
 * @returns A detailed object with all node fields.
 */
function toNodeDetail(node: Node): NodeDetail {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    instructions: node.instructions,
    delay: node.delay,
    resumeAt: node.resumeAt,
    agents: node.agents,
    fileOwnership: node.fileOwnership,
    retryCount: node.retryCount,
    maxRetries: node.maxRetries,
    reviewReport: node.reviewReport,
    cost: node.cost,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
  };
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers node routes.
 *
 * T078: GET /nodes — list all nodes with status/cost summaries.
 * T078: GET /nodes/:id — get detailed node info with agents/scopes/logs.
 * T079: GET /nodes/:id/review — get the Loomex review report for a node.
 *
 * @param options - Callbacks that supply runtime data.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function nodesRoutes(options: NodesRoutesOptions): FastifyPluginAsync {
  const { getWorkflow } = options;

  const plugin: FastifyPluginAsync = async (fastify): Promise<void> => {
    /**
     * GET /nodes
     *
     * Returns an array of node summaries for the active workflow.
     * Returns 404 if no workflow is active.
     */
    fastify.get('/nodes', async (_request, reply): Promise<void> => {
      const workflow = getWorkflow();

      if (workflow === null) {
        await reply.code(404).send({ error: 'No active workflow' });
        return;
      }

      const summaries: NodeSummary[] = Object.values(workflow.graph.nodes).map(toNodeSummary);

      await reply.code(200).send(summaries);
    });

    /**
     * GET /nodes/:id
     *
     * Returns detailed node data including agents, file ownership, and review report.
     * Returns 404 if no workflow is active or the node is not found.
     */
    fastify.get('/nodes/:id', async (request, reply): Promise<void> => {
      const workflow = getWorkflow();

      if (workflow === null) {
        await reply.code(404).send({ error: 'No active workflow' });
        return;
      }

      const parseResult = NodeParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: 'Invalid node ID',
          details: parseResult.error.issues,
        });
        return;
      }

      const node: Node | undefined = workflow.graph.nodes[parseResult.data.id];

      if (node === undefined) {
        await reply.code(404).send({ error: 'Node not found' });
        return;
      }

      await reply.code(200).send(toNodeDetail(node));
    });

    /**
     * GET /nodes/:id/review
     *
     * Returns the Loomex review report for a specific node.
     * Returns 404 if no workflow is active, the node is not found, or no review report exists.
     */
    fastify.get('/nodes/:id/review', async (request, reply): Promise<void> => {
      const workflow = getWorkflow();

      if (workflow === null) {
        await reply.code(404).send({ error: 'No active workflow' });
        return;
      }

      const parseResult = NodeParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: 'Invalid node ID',
          details: parseResult.error.issues,
        });
        return;
      }

      const node: Node | undefined = workflow.graph.nodes[parseResult.data.id];

      if (node === undefined) {
        await reply.code(404).send({ error: 'Node not found' });
        return;
      }

      if (node.reviewReport === null) {
        await reply.code(404).send({ error: 'No review report for this node' });
        return;
      }

      await reply.code(200).send(node.reviewReport);
    });
  };

  return plugin;
}
