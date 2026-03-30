import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer } from '../../src/api/server.js';
import type { WorkflowRoutesOptions } from '../../src/api/routes/workflow.js';
import type { NodesRoutesOptions } from '../../src/api/routes/nodes.js';
import type { LLMProvider, CompletionParams } from '../../src/providers/base.js';
import type { LLMResponse, Workflow, Event } from '../../src/types.js';
import type { CostTracker } from '../../src/costs/tracker.js';
import type { SharedMemoryManager } from '../../src/memory/shared-memory.js';
import type { FastifyInstance } from 'fastify';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal LLMResponse with text content. */
function textResponse(text: string): LLMResponse {
  return {
    content: [{ type: 'text', text }],
    model: 'mock-model',
    usage: { input: 100, output: 50 },
    stopReason: 'end_turn',
  };
}

/**
 * A valid 3-node linear graph JSON for the mock LLM's graph-building step.
 * Nodes: Setup → Implementation → Testing, connected linearly.
 */
const THREE_NODE_LINEAR_GRAPH = JSON.stringify({
  nodes: [
    {
      id: 'node-setup',
      title: 'Project Setup',
      instructions: '1. Initialize the project\n2. Create directory structure\n3. Install dependencies',
      dependencies: [],
    },
    {
      id: 'node-impl',
      title: 'Core Implementation',
      instructions: '1. Build the main module\n2. Create API endpoints\n3. Wire up database',
      dependencies: ['node-setup'],
    },
    {
      id: 'node-test',
      title: 'Testing',
      instructions: '1. Write unit tests\n2. Write integration tests\n3. Verify coverage',
      dependencies: ['node-impl'],
    },
  ],
});

/**
 * Build a mock LLM provider that returns text for spec steps
 * and the 3-node linear graph JSON for the graph step.
 *
 * The spec engine calls the provider 6 times:
 *   1: constitution, 2: spec, 3: plan, 4: tasks, 5: analysis, 6: graph
 *
 * @returns A mock LLMProvider instance.
 */
function createMockProvider(): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    complete: vi.fn(async (_params: CompletionParams): Promise<LLMResponse> => {
      callIndex++;
      console.log(`[E2E] LLM call #${String(callIndex)}`);
      if (callIndex === 6) {
        return textResponse('```json\n' + THREE_NODE_LINEAR_GRAPH + '\n```');
      }
      return textResponse(`# Step ${String(callIndex)} Content\nGenerated content for phase ${String(callIndex)}.`);
    }),
  };
}

/** Create a minimal mock SharedMemoryManager. */
function createMockSharedMemory(): SharedMemoryManager {
  return {
    initialize: vi.fn(async (): Promise<void> => undefined),
    read: vi.fn(async (): Promise<string> => ''),
    write: vi.fn(async (): Promise<void> => undefined),
    list: vi.fn(async (): Promise<Array<{ name: string; lastModifiedBy: string; lastModifiedAt: string }>> => []),
  } as unknown as SharedMemoryManager;
}

/** Create a minimal mock CostTracker. */
function createMockCostTracker(): CostTracker {
  return {
    trackCall: vi.fn(),
    getNodeCost: vi.fn((): number => 0),
    getTotalCost: vi.fn((): number => 0.42),
    isOverBudget: vi.fn((): boolean => false),
    getBudgetRemaining: vi.fn((): number | null => null),
    reset: vi.fn(),
  } as unknown as CostTracker;
}

/**
 * Poll GET /workflow until the status matches the expected value or timeout.
 *
 * @param server - Fastify instance to inject requests into.
 * @param token - Auth token for the Authorization header.
 * @param expectedStatus - The workflow status to wait for.
 * @param timeoutMs - Maximum wait time in milliseconds.
 * @returns The parsed workflow body when the status matches.
 */
async function pollWorkflowStatus(
  server: FastifyInstance,
  token: string,
  expectedStatus: string,
  timeoutMs: number = 10_000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  const interval = 100;

  while (Date.now() - start < timeoutMs) {
    const res = await server.inject({
      method: 'GET',
      url: '/workflow',
      headers: { authorization: `Bearer ${token}` },
    });

    if (res.statusCode === 200) {
      const body = JSON.parse(res.body) as Record<string, unknown>;
      if (body['status'] === expectedStatus) {
        return body;
      }
    }

    await new Promise<void>((resolve): void => {
      setTimeout(resolve, interval);
    });
  }

  throw new Error(`Workflow did not reach status '${expectedStatus}' within ${String(timeoutMs)}ms`);
}

// ============================================================================
// Test Suite
// ============================================================================

describe('End-to-end: init → spec → start → nodes (integration)', () => {
  let projectPath: string;
  let server: FastifyInstance;
  const AUTH_TOKEN = 'e2e-test-token-9876';

  /** In-memory workflow state shared across route handlers. */
  let currentWorkflow: Workflow | null = null;

  /** Captured events. */
  const events: Event[] = [];

  beforeEach(async () => {
    projectPath = join(
      tmpdir(),
      `loomflo-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(projectPath, { recursive: true });

    currentWorkflow = null;
    events.length = 0;

    /* Shared getters that return live state. */
    const getWorkflow = (): Workflow | null => currentWorkflow;
    const setWorkflow = (wf: Workflow): void => {
      console.log(`[E2E] setWorkflow: ${wf.status}`, new Error().stack?.split('\n').slice(1, 4).join(' | '));
      currentWorkflow = wf;
    };
    const mockProvider = createMockProvider();
    const mockSharedMemory = createMockSharedMemory();
    const mockCostTracker = createMockCostTracker();
    const mockEventLog = {
      append: async (event: Event): Promise<void> => {
        events.push(event);
      },
      query: async (): Promise<Event[]> => events,
    };

    const workflowOptions: WorkflowRoutesOptions = {
      getWorkflow,
      setWorkflow,
      getProvider: (): LLMProvider => mockProvider,
      getEventLog: () => mockEventLog,
      getSharedMemory: (): SharedMemoryManager => mockSharedMemory,
      getCostTracker: (): CostTracker => mockCostTracker,
    };

    const nodesOptions: NodesRoutesOptions = {
      getWorkflow,
    };

    const result = await createServer({
      token: AUTH_TOKEN,
      projectPath,
      dashboardPath: null,
      workflow: workflowOptions,
      nodes: nodesOptions,
    });

    server = result.server;
  });

  afterEach(async () => {
    await server.close();
    /* Brief wait for background spec generation to settle. */
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 200);
    });
    await rm(projectPath, { recursive: true, force: true }).catch((): void => {
      /* Best-effort cleanup. */
    });
  });

  // --------------------------------------------------------------------------
  // Full E2E Flow
  // --------------------------------------------------------------------------

  it('should complete the full init → spec → start flow', { timeout: 30_000 }, async () => {
    /* ---- Step 1: POST /workflow/init ----------------------------------- */
    const initRes = await server.inject({
      method: 'POST',
      url: '/workflow/init',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: {
        description: 'Build a REST API with auth and PostgreSQL',
        projectPath,
      },
    });

    expect(initRes.statusCode).toBe(201);
    const initBody = JSON.parse(initRes.body) as { id: string; status: string; description: string };
    expect(initBody.id).toBeDefined();
    expect(initBody.status).toBe('spec');
    expect(initBody.description).toBe('Build a REST API with auth and PostgreSQL');

    /* ---- Step 2: Poll until spec generation completes (→ building) ----- */
    const buildingBody = await pollWorkflowStatus(server, AUTH_TOKEN, 'building', 15_000);
    expect(buildingBody['id']).toBe(initBody.id);
    expect(buildingBody['graph']).toBeDefined();

    /* Verify graph has the 3 nodes from our mock. */
    const graph = buildingBody['graph'] as { nodes: Record<string, unknown> };
    const nodeIds = Object.keys(graph.nodes);
    expect(nodeIds.length).toBe(3);
    expect(nodeIds).toContain('node-setup');
    expect(nodeIds).toContain('node-impl');
    expect(nodeIds).toContain('node-test');

    /* ---- Step 3: GET /workflow confirms graph is present --------------- */
    const getRes = await server.inject({
      method: 'GET',
      url: '/workflow',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body) as { status: string; graph: { nodes: Record<string, unknown> } };
    expect(getBody.status).toBe('building');
    expect(Object.keys(getBody.graph.nodes).length).toBe(3);

    /* ---- Step 4: POST /workflow/start transitions to running ----------- */
    const startRes = await server.inject({
      method: 'POST',
      url: '/workflow/start',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(startRes.statusCode).toBe(200);
    const startBody = JSON.parse(startRes.body) as { status: string };
    expect(startBody.status).toBe('running');

    /* ---- Step 5: GET /workflow confirms running state ------------------ */
    const runningRes = await server.inject({
      method: 'GET',
      url: '/workflow',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(runningRes.statusCode).toBe(200);
    const runningBody = JSON.parse(runningRes.body) as { status: string };
    expect(runningBody.status).toBe('running');

    /* ---- Step 6: GET /nodes returns all 3 nodes ----------------------- */
    const nodesRes = await server.inject({
      method: 'GET',
      url: '/nodes',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(nodesRes.statusCode).toBe(200);
    const nodesBody = JSON.parse(nodesRes.body) as Array<{ id: string; title: string; status: string }>;
    expect(nodesBody.length).toBe(3);

    const titles = nodesBody.map((n) => n.title);
    expect(titles).toContain('Project Setup');
    expect(titles).toContain('Core Implementation');
    expect(titles).toContain('Testing');
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  it('should reject a second init while the first is in progress', async () => {
    await server.inject({
      method: 'POST',
      url: '/workflow/init',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { description: 'First project', projectPath },
    });

    const secondRes = await server.inject({
      method: 'POST',
      url: '/workflow/init',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { description: 'Second project', projectPath },
    });

    expect(secondRes.statusCode).toBe(409);
  });

  it('should show health endpoint without authentication', async () => {
    const healthRes = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(healthRes.statusCode).toBe(200);
    const body = JSON.parse(healthRes.body) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('should reject workflow operations without auth token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/workflow',
    });

    expect(res.statusCode).toBe(401);
  });

  it('should return 404 for nodes when no workflow exists', async () => {
    const nodesRes = await server.inject({
      method: 'GET',
      url: '/nodes',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(nodesRes.statusCode).toBe(404);
  });

  it('should return individual node detail after init and start', { timeout: 30_000 }, async () => {
    /* Init and wait for spec generation. */
    await server.inject({
      method: 'POST',
      url: '/workflow/init',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: {
        description: 'Build a todo app',
        projectPath,
      },
    });

    await pollWorkflowStatus(server, AUTH_TOKEN, 'building', 15_000);

    /* Start the workflow. */
    await server.inject({
      method: 'POST',
      url: '/workflow/start',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    /* Fetch individual node detail. */
    const nodeRes = await server.inject({
      method: 'GET',
      url: '/nodes/node-setup',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(nodeRes.statusCode).toBe(200);
    const nodeBody = JSON.parse(nodeRes.body) as { id: string; title: string; instructions: string };
    expect(nodeBody.id).toBe('node-setup');
    expect(nodeBody.title).toBe('Project Setup');
    expect(nodeBody.instructions).toBeDefined();
  });

  it('should return 404 for a non-existent node', { timeout: 30_000 }, async () => {
    /* Init and wait. */
    await server.inject({
      method: 'POST',
      url: '/workflow/init',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { description: 'Test', projectPath },
    });

    await pollWorkflowStatus(server, AUTH_TOKEN, 'building', 15_000);

    const nodeRes = await server.inject({
      method: 'GET',
      url: '/nodes/nonexistent-node',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(nodeRes.statusCode).toBe(404);
  });
});
