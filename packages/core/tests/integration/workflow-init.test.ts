import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createServer } from "../../src/api/server.js";
import type { WorkflowRoutesOptions } from "../../src/api/routes/workflow.js";
import type { LLMProvider, CompletionParams } from "../../src/providers/base.js";
import type { LLMResponse, Workflow, Event } from "../../src/types.js";
import type { CostTracker } from "../../src/costs/tracker.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";
import type { FastifyInstance } from "fastify";

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal LLMResponse with text content. */
function textResponse(text: string): LLMResponse {
  return {
    content: [{ type: "text", text }],
    model: "mock-model",
    usage: { input: 100, output: 50 },
    stopReason: "end_turn",
  };
}

/** A valid graph JSON for the mock LLM's graph-building step. */
const VALID_GRAPH_JSON = JSON.stringify({
  nodes: [
    {
      id: "node-1",
      title: "Setup",
      instructions: "1. Create project",
      dependencies: [],
    },
    {
      id: "node-2",
      title: "Feature",
      instructions: "1. Implement feature",
      dependencies: ["node-1"],
    },
  ],
});

/**
 * Build a mock LLM provider that returns text for spec steps
 * and JSON for the graph step. The spec engine calls 6 times:
 *   0: constitution, 1: spec, 2: plan, 3: tasks, 4: analysis, 5: graph
 */
function createMockProvider(): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    complete: vi.fn(async (_params: CompletionParams): Promise<LLMResponse> => {
      callIndex++;
      if (callIndex === 6) {
        return textResponse("```json\n" + VALID_GRAPH_JSON + "\n```");
      }
      return textResponse(`# Step ${String(callIndex)} Content\nGenerated content.`);
    }),
  };
}

/** Create a minimal mock SharedMemoryManager. */
function createMockSharedMemory(): SharedMemoryManager {
  return {
    initialize: vi.fn(async (): Promise<void> => undefined),
    read: vi.fn(async (): Promise<string> => ""),
    write: vi.fn(async (): Promise<void> => undefined),
    list: vi.fn(
      async (): Promise<
        Array<{ name: string; lastModifiedBy: string; lastModifiedAt: string }>
      > => [],
    ),
  } as unknown as SharedMemoryManager;
}

/** Create a minimal mock CostTracker. */
function createMockCostTracker(): CostTracker {
  return {
    trackCall: vi.fn(),
    getNodeCost: vi.fn((): number => 0),
    getTotalCost: vi.fn((): number => 0),
    isOverBudget: vi.fn((): boolean => false),
    getBudgetRemaining: vi.fn((): number | null => null),
    reset: vi.fn(),
  } as unknown as CostTracker;
}

// ============================================================================
// Test Suite
// ============================================================================

describe("POST /workflow/init (integration)", () => {
  let projectPath: string;
  let server: FastifyInstance;
  const AUTH_TOKEN = "test-token-12345";

  /** In-memory workflow state. */
  let currentWorkflow: Workflow | null = null;

  /** Captured events. */
  const events: Event[] = [];

  beforeEach(async () => {
    projectPath = join(
      tmpdir(),
      `loomflo-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(projectPath, { recursive: true });

    currentWorkflow = null;
    events.length = 0;

    const workflowOptions: WorkflowRoutesOptions = {
      getWorkflow: (): Workflow | null => currentWorkflow,
      setWorkflow: (wf: Workflow): void => {
        currentWorkflow = wf;
      },
      getProvider: (): LLMProvider => createMockProvider(),
      getEventLog: () => ({
        append: async (event: Event): Promise<void> => {
          events.push(event);
        },
        query: async (): Promise<Event[]> => events,
      }),
      getSharedMemory: (): SharedMemoryManager => createMockSharedMemory(),
      getCostTracker: (): CostTracker => createMockCostTracker(),
    };

    const result = await createServer({
      token: AUTH_TOKEN,
      projectPath,
      dashboardPath: null,
      workflow: workflowOptions,
    });

    server = result.server;
  });

  afterEach(async () => {
    await server.close();
    /* Wait briefly for any background spec generation to settle before cleanup. */
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 100);
    });
    await rm(projectPath, { recursive: true, force: true }).catch((): void => {
      /* Best-effort cleanup — ignore errors from background operations. */
    });
  });

  // --------------------------------------------------------------------------
  // POST /workflow/init
  // --------------------------------------------------------------------------

  it("should create a workflow and return 201", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/workflow/init",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: {
        description: "Build a todo app",
        projectPath,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { id: string; status: string; description: string };
    expect(body.id).toBeDefined();
    expect(body.status).toBe("spec");
    expect(body.description).toBe("Build a todo app");
  });

  it("should reject a second workflow init (409 conflict)", async () => {
    /* First init */
    await server.inject({
      method: "POST",
      url: "/workflow/init",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { description: "First project", projectPath },
    });

    /* Second init should fail */
    const response = await server.inject({
      method: "POST",
      url: "/workflow/init",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { description: "Second project", projectPath },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain("already active");
  });

  it("should reject missing description (400)", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/workflow/init",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { projectPath },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should reject missing projectPath (400)", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/workflow/init",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { description: "Build something" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should reject unauthenticated requests (401)", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/workflow/init",
      payload: { description: "Test", projectPath },
    });

    expect(response.statusCode).toBe(401);
  });

  it("should reject wrong token (401)", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/workflow/init",
      headers: { authorization: "Bearer wrong-token" },
      payload: { description: "Test", projectPath },
    });

    expect(response.statusCode).toBe(401);
  });

  // --------------------------------------------------------------------------
  // GET /workflow
  // --------------------------------------------------------------------------

  it("should return 404 when no workflow exists", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/workflow",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("should return the workflow after init", async () => {
    /* Create a workflow */
    await server.inject({
      method: "POST",
      url: "/workflow/init",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { description: "Build a todo app", projectPath },
    });

    /* Retrieve it */
    const response = await server.inject({
      method: "GET",
      url: "/workflow",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      id: string;
      status: string;
      description: string;
      projectPath: string;
      graph: unknown;
    };
    expect(body.description).toBe("Build a todo app");
    expect(body.projectPath).toBe(projectPath);
    expect(body.graph).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // POST /workflow/start
  // --------------------------------------------------------------------------

  it("should reject start when no workflow exists (404)", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/workflow/start",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("should reject start when workflow is in spec status (400)", async () => {
    /* Create a workflow (starts in 'spec' status) */
    await server.inject({
      method: "POST",
      url: "/workflow/init",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      payload: { description: "Build a todo app", projectPath },
    });

    /* Try to start immediately — workflow is in 'spec', not 'building' */
    const response = await server.inject({
      method: "POST",
      url: "/workflow/start",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain("building");
  });

  it("should start a workflow that is in building status", async () => {
    /* Directly set a workflow in 'building' status to simulate
     * spec generation completion without triggering the background process. */
    const now = new Date().toISOString();
    currentWorkflow = {
      id: "test-workflow-id",
      status: "building",
      description: "Build a todo app",
      projectPath,
      graph: { nodes: {}, edges: [], topology: "linear" },
      config: {} as Workflow["config"],
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
    };

    const response = await server.inject({
      method: "POST",
      url: "/workflow/start",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe("running");
    expect(currentWorkflow?.status).toBe("running");
  });

  // --------------------------------------------------------------------------
  // GET /health (no auth required)
  // --------------------------------------------------------------------------

  it("should return health without auth", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe("ok");
  });
});
