/**
 * Unit tests for packages/core/src/api/ HTTP routes using Fastify inject.
 *
 * Each route plugin is tested in isolation by building minimal Fastify
 * instances, registering only the route under test with mock dependencies,
 * and using Fastify's inject() method (no real network calls).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000001") };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(), readFile: vi.fn(), stat: vi.fn() };
});

vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return { ...actual, loadConfig: vi.fn() };
});

vi.mock("../../src/agents/loom.js", () => ({ LoomAgent: vi.fn() }));

vi.mock("../../src/persistence/state.js", () => ({
  saveWorkflowState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/persistence/events.js", () => ({ queryEvents: vi.fn() }));

vi.mock("../../src/workflow/workflow.js", () => ({
  WorkflowManager: { resume: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { readdir, readFile, stat } from "node:fs/promises";

import { healthRoutes } from "../../src/api/routes/health.js";
import type { HealthRoutesOptions, WorkflowSummary } from "../../src/api/routes/health.js";
import { workflowRoutes } from "../../src/api/routes/workflow.js";
import type { WorkflowRoutesOptions, EventLog } from "../../src/api/routes/workflow.js";
import { nodesRoutes } from "../../src/api/routes/nodes.js";
import type { NodesRoutesOptions } from "../../src/api/routes/nodes.js";
import { chatRoutes } from "../../src/api/routes/chat.js";
import type { ChatRoutesOptions, ChatHistoryEntry } from "../../src/api/routes/chat.js";
import { eventsRoutes } from "../../src/api/routes/events.js";
import type { EventsRoutesOptions } from "../../src/api/routes/events.js";
import { specsRoutes } from "../../src/api/routes/specs.js";
import type { SpecsRoutesOptions } from "../../src/api/routes/specs.js";
import { costsRoutes } from "../../src/api/routes/costs.js";
import type { CostsRoutesOptions } from "../../src/api/routes/costs.js";
import { memoryRoutes } from "../../src/api/routes/memory.js";
import type { MemoryRoutesOptions } from "../../src/api/routes/memory.js";

import { DEFAULT_CONFIG, loadConfig } from "../../src/config.js";
import { LoomAgent } from "../../src/agents/loom.js";
import { saveWorkflowState } from "../../src/persistence/state.js";
import { queryEvents } from "../../src/persistence/events.js";

import type { Workflow, Node, Event } from "../../src/types.js";
import type { LLMProvider } from "../../src/providers/base.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";
import type { CostTracker, CostSummary } from "../../src/costs/tracker.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_TOKEN = "test-secret-token";
const BEARER = `Bearer ${AUTH_TOKEN}`;

// Type alias for mock function references (avoids overload resolution issues
// with node:fs/promises functions that have multiple call signatures).
type MockFn = ReturnType<typeof vi.fn>;

const mockReaddir: MockFn = readdir as unknown as MockFn;
const mockReadFile: MockFn = readFile as unknown as MockFn;
const mockStat: MockFn = stat as unknown as MockFn;

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

/** Create a mock Workflow with sensible defaults. */
function createMockWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "building",
    description: "Test workflow",
    projectPath: "/test/project",
    graph: { nodes: {}, edges: [], topology: "linear" },
    config: DEFAULT_CONFIG,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    totalCost: 0,
    ...overrides,
  };
}

/** Create a mock Node with sensible defaults. */
function createMockNode(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    title: `Node ${id}`,
    status: "running",
    instructions: "Test instructions",
    delay: "0",
    resumeAt: null,
    agents: [],
    fileOwnership: {},
    retryCount: 0,
    maxRetries: 3,
    reviewReport: null,
    cost: 0.5,
    startedAt: "2026-03-24T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Auth hook helper
// ---------------------------------------------------------------------------

/** Register a Bearer-token auth hook matching the server's onRequest hook. */
function addAuthHook(server: FastifyInstance): void {
  server.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (request.method === "GET" && request.url === "/health") return;
      const header: string | undefined = request.headers.authorization;
      if (!header?.startsWith("Bearer ") || header.slice(7) !== AUTH_TOKEN) {
        await reply.code(401).send({ error: "Unauthorized" });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Global setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Health routes
// ===========================================================================

/** Tests for GET /health -- unauthenticated health check endpoint. */
describe("GET /health", () => {
  let server: FastifyInstance;

  const workflowSummary: WorkflowSummary = {
    id: "wf-1",
    status: "running",
    nodeCount: 3,
    activeNodes: ["node-1"],
  };

  afterEach(async () => {
    await server.close();
  });

  it("returns status ok with workflow summary when a workflow is active", async () => {
    const options: HealthRoutesOptions = {
      getUptime: vi.fn((): number => 42),
      getWorkflow: vi.fn((): WorkflowSummary => workflowSummary),
    };
    server = Fastify();
    await server.register(healthRoutes(options));
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body: Record<string, unknown> = res.json();
    expect(body.status).toBe("ok");
    expect(body.uptime).toBe(42);
    expect(body.version).toBe("0.1.0");
    expect(body.workflow).toEqual(workflowSummary);
  });

  it("returns null workflow when no workflow is active", async () => {
    const options: HealthRoutesOptions = {
      getUptime: vi.fn((): number => 10),
      getWorkflow: vi.fn((): null => null),
    };
    server = Fastify();
    await server.register(healthRoutes(options));
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json().workflow).toBeNull();
  });
});

// ===========================================================================
// Workflow routes
// ===========================================================================

/** Tests for workflow routes: GET /workflow, POST /workflow/init, POST /workflow/start. */
describe("workflow routes", () => {
  let server: FastifyInstance;
  let currentWorkflow: Workflow | null;
  let mockOptions: WorkflowRoutesOptions;

  beforeEach(async () => {
    currentWorkflow = null;

    const mockEventLog: EventLog = {
      append: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
    };

    mockOptions = {
      getWorkflow: vi.fn((): Workflow | null => currentWorkflow),
      setWorkflow: vi.fn((wf: Workflow): void => {
        currentWorkflow = wf;
      }),
      getProvider: vi.fn((): LLMProvider => ({ complete: vi.fn() }) as unknown as LLMProvider),
      getEventLog: vi.fn((): EventLog => mockEventLog),
      getSharedMemory: vi.fn((): SharedMemoryManager => ({}) as unknown as SharedMemoryManager),
      getCostTracker: vi.fn((): CostTracker => ({}) as unknown as CostTracker),
    };

    vi.mocked(LoomAgent).mockImplementation(
      () =>
        ({
          runSpecGeneration: vi.fn().mockResolvedValue({
            graph: { nodes: {}, edges: [], topology: "linear" },
          }),
        }) as unknown as InstanceType<typeof LoomAgent>,
    );

    vi.mocked(loadConfig).mockResolvedValue(DEFAULT_CONFIG);
    vi.mocked(saveWorkflowState).mockResolvedValue(undefined);

    server = Fastify();
    addAuthHook(server);
    await server.register(workflowRoutes(mockOptions));
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /workflow", () => {
    it("returns workflow state when active", async () => {
      currentWorkflow = createMockWorkflow();

      const res = await server.inject({
        method: "GET",
        url: "/workflow",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      const body: Record<string, unknown> = res.json();
      expect(body.id).toBe(currentWorkflow.id);
      expect(body.status).toBe("building");
      expect(body.description).toBe("Test workflow");
      expect(body.graph).toBeDefined();
    });

    it("returns 404 when no workflow is active", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/workflow",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("No active workflow");
    });

    it("returns 401 without authorization header", async () => {
      const res = await server.inject({ method: "GET", url: "/workflow" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /workflow/init", () => {
    it("creates a new workflow and returns 201", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/workflow/init",
        headers: { authorization: BEARER, "content-type": "application/json" },
        payload: { description: "Build an app", projectPath: "/test/project" },
      });

      expect(res.statusCode).toBe(201);
      const body: Record<string, unknown> = res.json();
      expect(body.id).toBe("00000000-0000-0000-0000-000000000001");
      expect(body.status).toBe("spec");
      expect(body.description).toBe("Build an app");
    });

    it("returns 400 on invalid request body", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/workflow/init",
        headers: { authorization: BEARER, "content-type": "application/json" },
        payload: { description: "" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Invalid request body");
    });

    it("returns 409 when a workflow is already active", async () => {
      currentWorkflow = createMockWorkflow();

      const res = await server.inject({
        method: "POST",
        url: "/workflow/init",
        headers: { authorization: BEARER, "content-type": "application/json" },
        payload: { description: "Another app", projectPath: "/test/project" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("A workflow is already active");
    });
  });

  describe("POST /workflow/start", () => {
    it("returns 200 and transitions to running when in building state", async () => {
      currentWorkflow = createMockWorkflow({ status: "building" });

      const res = await server.inject({
        method: "POST",
        url: "/workflow/start",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("running");
      expect(vi.mocked(saveWorkflowState)).toHaveBeenCalled();
    });

    it("returns 400 when workflow is not in building state", async () => {
      currentWorkflow = createMockWorkflow({ status: "running" });

      const res = await server.inject({
        method: "POST",
        url: "/workflow/start",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Workflow not in building state");
    });

    it("returns 404 when no workflow exists", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/workflow/start",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("No active workflow");
    });
  });
});

// ===========================================================================
// Nodes routes
// ===========================================================================

/** Tests for node routes: GET /nodes and GET /nodes/:id. */
describe("nodes routes", () => {
  let server: FastifyInstance;
  let currentWorkflow: Workflow | null;

  beforeEach(async () => {
    currentWorkflow = null;
    const options: NodesRoutesOptions = {
      getWorkflow: vi.fn((): Workflow | null => currentWorkflow),
    };
    server = Fastify();
    addAuthHook(server);
    await server.register(nodesRoutes(options));
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /nodes", () => {
    it("returns node summaries for the active workflow", async () => {
      const node: Node = createMockNode("node-1");
      currentWorkflow = createMockWorkflow({
        graph: { nodes: { "node-1": node }, edges: [], topology: "linear" },
      });

      const res = await server.inject({
        method: "GET",
        url: "/nodes",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      const body: Record<string, unknown>[] = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("node-1");
      expect(body[0].title).toBe("Node node-1");
      expect(body[0].agentCount).toBe(0);
    });

    it("returns 404 when no workflow is active", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/nodes",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("No active workflow");
    });
  });

  describe("GET /nodes/:id", () => {
    it("returns node detail for a valid id", async () => {
      const node: Node = createMockNode("node-1");
      currentWorkflow = createMockWorkflow({
        graph: { nodes: { "node-1": node }, edges: [], topology: "linear" },
      });

      const res = await server.inject({
        method: "GET",
        url: "/nodes/node-1",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      const body: Record<string, unknown> = res.json();
      expect(body.id).toBe("node-1");
      expect(body.instructions).toBe("Test instructions");
      expect(body.agents).toEqual([]);
      expect(body.fileOwnership).toEqual({});
    });

    it("returns 404 for an unknown node id", async () => {
      currentWorkflow = createMockWorkflow({
        graph: {
          nodes: { "node-1": createMockNode("node-1") },
          edges: [],
          topology: "linear",
        },
      });

      const res = await server.inject({
        method: "GET",
        url: "/nodes/nonexistent",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Node not found");
    });

    it("returns 404 when no workflow is active", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/nodes/node-1",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("No active workflow");
    });
  });
});

// ===========================================================================
// Chat routes
// ===========================================================================

/** Tests for chat routes: POST /chat and GET /chat/history. */
describe("chat routes", () => {
  let server: FastifyInstance;
  let chatHistory: ChatHistoryEntry[];

  beforeEach(async () => {
    chatHistory = [];

    const options: ChatRoutesOptions = {
      handleChat: vi.fn().mockResolvedValue({
        response: "I can help with that",
        category: "question",
        modification: null,
      }),
      getChatHistory: vi.fn((): ChatHistoryEntry[] => chatHistory),
      addToHistory: vi.fn((entry: ChatHistoryEntry): void => {
        chatHistory.push(entry);
      }),
    };

    server = Fastify();
    addAuthHook(server);
    await server.register(chatRoutes(options));
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("POST /chat", () => {
    it("returns response with category and null action", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/chat",
        headers: { authorization: BEARER, "content-type": "application/json" },
        payload: { message: "What is this project?" },
      });

      expect(res.statusCode).toBe(200);
      const body: Record<string, unknown> = res.json();
      expect(body.response).toBe("I can help with that");
      expect(body.category).toBe("question");
      expect(body.action).toBeNull();
    });

    it("returns 400 on empty message", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/chat",
        headers: { authorization: BEARER, "content-type": "application/json" },
        payload: { message: "" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Invalid request body");
    });
  });

  describe("GET /chat/history", () => {
    it("returns chat history array", async () => {
      chatHistory.push({
        role: "user",
        content: "Hello",
        timestamp: "2026-03-24T00:00:00.000Z",
      });

      const res = await server.inject({
        method: "GET",
        url: "/chat/history",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      const body: { messages: ChatHistoryEntry[] } = res.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[0].content).toBe("Hello");
    });

    it("returns 401 without authorization header", async () => {
      const res = await server.inject({ method: "GET", url: "/chat/history" });
      expect(res.statusCode).toBe(401);
    });
  });
});

// ===========================================================================
// Events routes
// ===========================================================================

/** Tests for event log routes: GET /events. */
describe("events routes", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const options: EventsRoutesOptions = {
      getProjectPath: vi.fn((): string => "/test/project"),
    };

    server = Fastify();
    addAuthHook(server);
    await server.register(eventsRoutes(options));
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /events", () => {
    it("returns events array with total count", async () => {
      const mockEvent: Event = {
        ts: "2026-03-24T00:00:00.000Z",
        type: "workflow_created",
        workflowId: "wf-1",
        nodeId: null,
        agentId: null,
        details: {},
      };
      vi.mocked(queryEvents).mockResolvedValue([mockEvent]);

      const res = await server.inject({
        method: "GET",
        url: "/events",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      const body: { events: Event[]; total: number } = res.json();
      expect(body.total).toBe(1);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].type).toBe("workflow_created");
    });

    it("passes query parameters as filters to queryEvents", async () => {
      vi.mocked(queryEvents).mockResolvedValue([]);

      const res = await server.inject({
        method: "GET",
        url: "/events?type=node_started&nodeId=node-1&limit=10&offset=0",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(queryEvents)).toHaveBeenCalledWith(
        "/test/project",
        expect.objectContaining({ type: "node_started", nodeId: "node-1" }),
      );
    });
  });
});

// ===========================================================================
// Specs routes
// ===========================================================================

/** Tests for spec artifact routes: GET /specs and GET /specs/:name. */
describe("specs routes", () => {
  let server: FastifyInstance;
  let currentWorkflow: Workflow | null;

  beforeEach(async () => {
    currentWorkflow = null;
    const options: SpecsRoutesOptions = {
      getWorkflow: vi.fn((): Workflow | null => currentWorkflow),
    };

    server = Fastify();
    addAuthHook(server);
    await server.register(specsRoutes(options));
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /specs", () => {
    it("returns spec artifacts list", async () => {
      currentWorkflow = createMockWorkflow();
      mockReaddir.mockResolvedValue(["spec.md"]);
      mockStat.mockResolvedValue({ isFile: (): boolean => true, size: 256 });

      const res = await server.inject({
        method: "GET",
        url: "/specs",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      const body: { artifacts: { name: string; path: string; size: number }[] } = res.json();
      expect(body.artifacts).toHaveLength(1);
      expect(body.artifacts[0].name).toBe("spec.md");
      expect(body.artifacts[0].path).toBe(".loomflo/specs/spec.md");
      expect(body.artifacts[0].size).toBe(256);
    });

    it("returns 404 when no workflow is active", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/specs",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("No active workflow");
    });
  });

  describe("GET /specs/:name", () => {
    it("returns spec content as markdown", async () => {
      currentWorkflow = createMockWorkflow();
      mockReadFile.mockResolvedValue("# Specification\n\nDetails here.");

      const res = await server.inject({
        method: "GET",
        url: "/specs/spec.md",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("# Specification\n\nDetails here.");
    });

    it("returns 404 when spec file is not found", async () => {
      currentWorkflow = createMockWorkflow();
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      mockReadFile.mockRejectedValue(err);

      const res = await server.inject({
        method: "GET",
        url: "/specs/missing.md",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Artifact not found");
    });
  });
});

// ===========================================================================
// Costs routes
// ===========================================================================

/** Tests for cost routes: GET /costs. */
describe("costs routes", () => {
  let server: FastifyInstance;
  let currentWorkflow: Workflow | null;

  const mockSummary: CostSummary = {
    totalCost: 1.5,
    perNode: { "node-1": 1.0 },
    perAgent: {},
    budgetLimit: 10,
    budgetRemaining: 8.5,
  };

  beforeEach(async () => {
    currentWorkflow = null;
    const options: CostsRoutesOptions = {
      getCostSummary: vi.fn((): CostSummary => mockSummary),
      getWorkflow: vi.fn((): Workflow | null => currentWorkflow),
      getLoomCost: vi.fn((): number => 0.5),
    };

    server = Fastify();
    addAuthHook(server);
    await server.register(costsRoutes(options));
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /costs", () => {
    it("returns cost summary with node breakdown", async () => {
      const node: Node = createMockNode("node-1");
      currentWorkflow = createMockWorkflow({
        graph: { nodes: { "node-1": node }, edges: [], topology: "linear" },
      });

      const res = await server.inject({
        method: "GET",
        url: "/costs",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      const body: Record<string, unknown> = res.json();
      expect(body.total).toBe(1.5);
      expect(body.budgetLimit).toBe(10);
      expect(body.budgetRemaining).toBe(8.5);
      expect(body.loomCost).toBe(0.5);
      const nodes = body.nodes as { id: string; cost: number }[];
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe("node-1");
      expect(nodes[0].cost).toBe(1.0);
    });

    it("returns 404 when no workflow is active", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/costs",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("No active workflow");
    });
  });
});

// ===========================================================================
// Memory routes
// ===========================================================================

/** Tests for shared memory routes: GET /memory and GET /memory/:name. */
describe("memory routes", () => {
  let server: FastifyInstance;
  let mockSharedMemory: SharedMemoryManager | null;

  beforeEach(async () => {
    mockSharedMemory = null;
    const options: MemoryRoutesOptions = {
      getSharedMemory: vi.fn((): SharedMemoryManager | null => mockSharedMemory),
    };

    server = Fastify();
    addAuthHook(server);
    await server.register(memoryRoutes(options));
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /memory", () => {
    it("returns memory file list", async () => {
      mockSharedMemory = {
        list: vi.fn().mockResolvedValue([
          {
            name: "DECISIONS.md",
            path: ".loomflo/shared-memory/DECISIONS.md",
            content: "# Decisions",
            lastModifiedBy: "loom",
            lastModifiedAt: "2026-03-24T00:00:00.000Z",
          },
        ]),
      } as unknown as SharedMemoryManager;

      const res = await server.inject({
        method: "GET",
        url: "/memory",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      const body: { files: { name: string; lastModifiedBy: string }[] } = res.json();
      expect(body.files).toHaveLength(1);
      expect(body.files[0].name).toBe("DECISIONS.md");
      expect(body.files[0].lastModifiedBy).toBe("loom");
    });

    it("returns 404 when no workflow is active", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/memory",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("No active workflow");
    });
  });

  describe("GET /memory/:name", () => {
    it("returns memory file content as markdown", async () => {
      mockSharedMemory = {
        read: vi.fn().mockResolvedValue({
          name: "DECISIONS.md",
          path: ".loomflo/shared-memory/DECISIONS.md",
          content: "# Decisions\n\nSome content.",
          lastModifiedBy: "loom",
          lastModifiedAt: "2026-03-24T00:00:00.000Z",
        }),
      } as unknown as SharedMemoryManager;

      const res = await server.inject({
        method: "GET",
        url: "/memory/DECISIONS.md",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("# Decisions\n\nSome content.");
    });

    it("returns 404 when memory file is not found", async () => {
      mockSharedMemory = {
        read: vi.fn().mockRejectedValue(new Error("Shared memory file not found: MISSING.md")),
      } as unknown as SharedMemoryManager;

      const res = await server.inject({
        method: "GET",
        url: "/memory/MISSING.md",
        headers: { authorization: BEARER },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Memory file not found");
    });
  });
});
