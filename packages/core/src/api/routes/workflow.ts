import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LoomAgent } from '../../agents/loom.js';
import { loadConfig, PartialConfigSchema } from '../../config.js';
import type { CostTracker } from '../../costs/tracker.js';
import type { SharedMemoryManager } from '../../memory/shared-memory.js';
import type { EventQueryFilters } from '../../persistence/events.js';
import { saveWorkflowState } from '../../persistence/state.js';
import type { LLMProvider } from '../../providers/base.js';
import type { Event, Workflow } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

/** Wrapper interface for event log access with a bound project path. */
export interface EventLog {
  /** Append a single event to the log. */
  append: (event: Event) => Promise<void>;
  /** Query events with optional filters. */
  query: (filters?: EventQueryFilters) => Promise<Event[]>;
}

/** Options accepted by the {@link workflowRoutes} factory. */
export interface WorkflowRoutesOptions {
  /** Return the current active workflow, or null if none exists. */
  getWorkflow: () => Workflow | null;
  /** Set the active workflow in memory. */
  setWorkflow: (workflow: Workflow) => void;
  /** Return the configured LLM provider. */
  getProvider: () => LLMProvider;
  /** Return the event log accessor for the current project. */
  getEventLog: () => EventLog;
  /** Return the shared memory manager. */
  getSharedMemory: () => SharedMemoryManager;
  /** Return the cost tracker. */
  getCostTracker: () => CostTracker;
}

// ============================================================================
// Request / Response Schemas
// ============================================================================

/** Zod schema for the POST /workflow/init request body. */
const InitRequestSchema = z.object({
  description: z.string().min(1),
  projectPath: z.string().min(1),
  config: PartialConfigSchema.optional(),
});

/** Shape of the POST /workflow/init JSON response. */
interface InitResponse {
  id: string;
  status: string;
  description: string;
}

/** Shape of the GET /workflow JSON response. */
interface GetWorkflowResponse {
  id: string;
  status: string;
  description: string;
  projectPath: string;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
  graph: Workflow['graph'];
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers workflow routes.
 *
 * T055: POST /workflow/init — start Phase 1 (spec generation).
 * T056: GET /workflow — return current workflow state including graph.
 *
 * @param options - Callbacks that supply runtime data and services.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function workflowRoutes(options: WorkflowRoutesOptions): FastifyPluginAsync {
  const { getWorkflow, setWorkflow } = options;

  const plugin: FastifyPluginAsync = async (fastify): Promise<void> => {
    /**
     * GET /workflow
     *
     * Returns the current workflow state including the execution graph.
     * Returns 404 if no workflow is active.
     */
    fastify.get('/workflow', async (_request, reply): Promise<void> => {
      const workflow = getWorkflow();

      if (workflow === null) {
        await reply.code(404).send({ error: 'No active workflow' });
        return;
      }

      await reply.code(200).send({
        id: workflow.id,
        status: workflow.status,
        description: workflow.description,
        projectPath: workflow.projectPath,
        totalCost: workflow.totalCost,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        graph: workflow.graph,
      } satisfies GetWorkflowResponse);
    });

    /**
     * POST /workflow/init
     *
     * Start Phase 1 (spec generation) from a natural language prompt.
     * Creates a workflow, launches LoomAgent spec generation in the background,
     * and returns immediately with the workflow ID.
     */
    fastify.post('/workflow/init', async (request, reply): Promise<void> => {
      const parseResult = InitRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: 'Invalid request body',
          details: parseResult.error.issues,
        });
        return;
      }

      const body = parseResult.data;

      if (getWorkflow() !== null) {
        await reply.code(409).send({ error: 'A workflow is already active' });
        return;
      }

      let mergedConfig;
      try {
        mergedConfig = await loadConfig({
          projectPath: body.projectPath,
          overrides: body.config,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await reply.code(400).send({ error: `Invalid configuration: ${message}` });
        return;
      }

      const now = new Date().toISOString();
      const id = randomUUID();
      const workflow: Workflow = {
        id,
        status: 'spec',
        description: body.description,
        projectPath: body.projectPath,
        graph: { nodes: {}, edges: [], topology: 'linear' },
        config: mergedConfig,
        createdAt: now,
        updatedAt: now,
        totalCost: 0,
      };

      setWorkflow(workflow);

      void runSpecGenerationBackground(workflow, options);

      await reply.code(201).send({
        id: workflow.id,
        status: workflow.status,
        description: workflow.description,
      } satisfies InitResponse);
    });
  };

  return plugin;
}

// ============================================================================
// Background Helpers
// ============================================================================

/**
 * Run spec generation in the background and update the workflow on completion.
 *
 * On success: updates workflow status to 'building', sets the graph, persists.
 * On failure: updates workflow status to 'failed', persists.
 *
 * @param workflow - The newly created workflow in 'spec' status.
 * @param options - Route options providing access to services.
 */
async function runSpecGenerationBackground(
  workflow: Workflow,
  options: WorkflowRoutesOptions,
): Promise<void> {
  const { setWorkflow, getProvider, getSharedMemory, getCostTracker } = options;

  const loom = new LoomAgent({
    provider: getProvider(),
    projectPath: workflow.projectPath,
    eventLog: { workflowId: workflow.id },
    sharedMemory: getSharedMemory(),
    costTracker: getCostTracker(),
  });

  try {
    const result = await loom.runSpecGeneration(workflow.description);

    const updated: Workflow = {
      ...workflow,
      status: 'building',
      graph: result.graph,
      updatedAt: new Date().toISOString(),
    };

    setWorkflow(updated);
    await saveWorkflowState(updated.projectPath, updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workflow] Spec generation failed for ${workflow.id}: ${message}`);

    const updated: Workflow = {
      ...workflow,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    };

    setWorkflow(updated);
    await saveWorkflowState(updated.projectPath, updated);
  }
}
