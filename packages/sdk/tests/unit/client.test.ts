/**
 * Unit tests for packages/sdk/src/client.ts — LoomfloClient.
 *
 * Covers constructor, every REST method, LoomfloApiError, WebSocket
 * connect/disconnect, event subscription/unsubscription, handleMessage
 * dispatch, and the private request() helper (via public method assertions).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LoomfloClient,
  LoomfloApiError,
  type LoomfloClientOptions,
  type HealthResponse,
  type WorkflowResponse,
  type InitResponse,
  type ChatResponse,
  type ChatHistoryResponse,
  type NodeSummary,
  type NodeDetailResponse,
  type CostsResponse,
  type EventsResponse,
} from "../../src/client.js";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

/** Minimal WebSocket mock supporting addEventListener, removeEventListener, close. */
class MockWebSocket {
  readonly url: string;
  private readonly _listeners: Map<string, Set<(arg: unknown) => void>> = new Map();

  constructor(url: string) {
    this.url = url;
    capturedWebSockets.push(this);
  }

  addEventListener(
    event: string,
    handler: (arg: unknown) => void,
    _options?: { once?: boolean },
  ): void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
  }

  removeEventListener(event: string, handler: (arg: unknown) => void): void {
    this._listeners.get(event)?.delete(handler);
  }

  close(): void {
    /* no-op for test */
  }

  /** Test helper: fire a specific event to all registered listeners. */
  _emit(event: string, arg?: unknown): void {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(arg as unknown);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

/** Create a mock Response with configurable status and body. */
function createMockResponse(options: {
  ok: boolean;
  status: number;
  body: unknown;
  parseJsonFails?: boolean;
}): Response {
  const jsonFn = options.parseJsonFails
    ? vi.fn().mockRejectedValue(new SyntaxError("bad json"))
    : vi.fn().mockResolvedValue(options.body);

  const textBody = typeof options.body === "string" ? options.body : JSON.stringify(options.body);

  return {
    ok: options.ok,
    status: options.status,
    json: jsonFn,
    text: vi.fn().mockResolvedValue(textBody),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;
let capturedWebSockets: MockWebSocket[];

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  capturedWebSockets = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a default client for most tests. */
function createClient(overrides?: Partial<LoomfloClientOptions>): LoomfloClient {
  return new LoomfloClient({ token: "test-token", ...overrides });
}

// ===========================================================================
// Constructor
// ===========================================================================

describe("LoomfloClient constructor", () => {
  it("should store defaults when host/port are omitted", () => {
    const client = createClient();
    const internals = client as unknown as Record<string, unknown>;
    expect(internals["baseUrl"]).toBe("http://127.0.0.1:3000");
    expect(internals["wsUrl"]).toBe("ws://127.0.0.1:3000");
    expect(internals["token"]).toBe("test-token");
  });

  it("should use provided host and port", () => {
    const client = createClient({ host: "10.0.0.1", port: 9000 });
    const internals = client as unknown as Record<string, unknown>;
    expect(internals["baseUrl"]).toBe("http://10.0.0.1:9000");
    expect(internals["wsUrl"]).toBe("ws://10.0.0.1:9000");
  });
});

// ===========================================================================
// Private request() — tested via public methods
// ===========================================================================

describe("request (private, via public methods)", () => {
  it("should set Authorization header with Bearer token", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: true, status: 200, body: { status: "ok" } }),
    );

    const client = createClient({ token: "my-secret" });
    await client.health();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-secret");
  });

  it("should set Content-Type for POST requests", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: true, status: 200, body: { response: "", action: null } }),
    );

    const client = createClient();
    await client.chat("hello");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ message: "hello" }));
  });

  it("should not set Content-Type for GET requests", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: true, status: 200, body: { status: "ok" } }),
    );

    const client = createClient();
    await client.health();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("should parse JSON response body", async () => {
    const payload: HealthResponse = {
      status: "ok",
      uptime: 120,
      version: "1.0.0",
      workflow: null,
    };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: payload }));

    const client = createClient();
    const result = await client.health();

    expect(result).toEqual(payload);
  });
});

// ===========================================================================
// LoomfloApiError
// ===========================================================================

describe("LoomfloApiError", () => {
  it("should be thrown on non-2xx response with JSON body", async () => {
    const errorBody = { error: "not found" };
    mockFetch.mockResolvedValue(createMockResponse({ ok: false, status: 404, body: errorBody }));

    const client = createClient();

    try {
      await client.health();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LoomfloApiError);
      const apiErr = err as LoomfloApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.body).toEqual(errorBody);
      expect(apiErr.message).toContain("GET /health");
      expect(apiErr.message).toContain("404");
      expect(apiErr.name).toBe("LoomfloApiError");
    }
  });

  it("should fall back to text body when JSON parsing fails", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({
        ok: false,
        status: 500,
        body: "Internal Server Error",
        parseJsonFails: true,
      }),
    );

    const client = createClient();

    try {
      await client.health();
      expect.fail("should have thrown");
    } catch (err) {
      const apiErr = err as LoomfloApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.body).toBe("Internal Server Error");
    }
  });

  it("should have correct name, status, body properties", () => {
    const err = new LoomfloApiError(422, "Validation failed", { field: "name" });
    expect(err.name).toBe("LoomfloApiError");
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ field: "name" });
    expect(err.message).toBe("Validation failed");
    expect(err).toBeInstanceOf(Error);
  });
});

// ===========================================================================
// REST API — health()
// ===========================================================================

describe("health()", () => {
  it("should call GET /health and return HealthResponse", async () => {
    const payload: HealthResponse = {
      status: "ok",
      uptime: 60,
      version: "0.1.0",
      workflow: { id: "wf-1", status: "running", nodeCount: 3, activeNodes: ["n1"] },
    };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: payload }));

    const client = createClient();
    const result = await client.health();

    expect(result).toEqual(payload);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/health");
    expect(init.method).toBe("GET");
  });
});

// ===========================================================================
// REST API — getWorkflow()
// ===========================================================================

describe("getWorkflow()", () => {
  it("should call GET /workflow and return WorkflowResponse", async () => {
    const payload: WorkflowResponse = {
      id: "wf-1",
      status: "running",
      description: "Build an app",
      projectPath: "/tmp/project",
      totalCost: 1.5,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T01:00:00Z",
      graph: { nodes: [], edges: [], topology: "linear" },
    };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: payload }));

    const client = createClient();
    const result = await client.getWorkflow();

    expect(result).toEqual(payload);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/workflow");
  });

  it("should return null when the API responds with 404", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: false, status: 404, body: { error: "no workflow" } }),
    );

    const client = createClient();
    const result = await client.getWorkflow();

    expect(result).toBeNull();
  });

  it("should throw on non-404 errors", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: false, status: 500, body: { error: "crash" } }),
    );

    const client = createClient();
    await expect(client.getWorkflow()).rejects.toThrow(LoomfloApiError);
  });
});

// ===========================================================================
// REST API — init()
// ===========================================================================

describe("init()", () => {
  it("should call POST /workflow/init with correct body", async () => {
    const payload: InitResponse = {
      id: "wf-2",
      status: "init",
      description: "New project",
    };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: payload }));

    const client = createClient();
    const result = await client.init("New project", "/tmp/proj", { level: 2 });

    expect(result).toEqual(payload);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/workflow/init");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      description: "New project",
      projectPath: "/tmp/proj",
      config: { level: 2 },
    });
  });

  it("should omit config when not provided", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({
        ok: true,
        status: 200,
        body: { id: "wf-3", status: "init", description: "x" },
      }),
    );

    const client = createClient();
    await client.init("x", "/tmp/x");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed["config"]).toBeUndefined();
  });
});

// ===========================================================================
// REST API — start()
// ===========================================================================

describe("start()", () => {
  it("should call POST /workflow/start", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: {} }));

    const client = createClient();
    await client.start();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/workflow/start");
    expect(init.method).toBe("POST");
  });
});

// ===========================================================================
// REST API — pause() / resume()
// ===========================================================================

describe("pause()", () => {
  it("should call POST /workflow/pause", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: {} }));

    const client = createClient();
    await client.pause();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/workflow/pause");
    expect(init.method).toBe("POST");
  });
});

describe("resume()", () => {
  it("should call POST /workflow/resume", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: {} }));

    const client = createClient();
    await client.resume();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/workflow/resume");
    expect(init.method).toBe("POST");
  });
});

// ===========================================================================
// REST API — chat()
// ===========================================================================

describe("chat()", () => {
  it("should call POST /chat with message and return ChatResponse", async () => {
    const payload: ChatResponse = {
      response: "I'll build that for you",
      action: { type: "graph_modification", details: { added: 2 } },
    };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: payload }));

    const client = createClient();
    const result = await client.chat("Build a REST API");

    expect(result).toEqual(payload);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ message: "Build a REST API" });
  });
});

// ===========================================================================
// REST API — chatHistory()
// ===========================================================================

describe("chatHistory()", () => {
  it("should call GET /chat/history and return messages", async () => {
    const payload: ChatHistoryResponse = {
      messages: [
        { role: "user", content: "Hello", timestamp: "2026-01-01T00:00:00Z" },
        { role: "assistant", content: "Hi!", timestamp: "2026-01-01T00:00:01Z" },
      ],
    };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: payload }));

    const client = createClient();
    const result = await client.chatHistory();

    expect(result).toEqual(payload);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/chat/history");
    expect(init.method).toBe("GET");
  });
});

// ===========================================================================
// REST API — getNodes()
// ===========================================================================

describe("getNodes()", () => {
  it("should call GET /nodes and return node summaries array", async () => {
    const nodes: NodeSummary[] = [
      { id: "n1", title: "Auth", status: "running", agentCount: 2, cost: 0.5, retryCount: 0 },
      { id: "n2", title: "DB", status: "pending", agentCount: 1, cost: 0, retryCount: 0 },
    ];
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: { nodes } }));

    const client = createClient();
    const result = await client.getNodes();

    expect(result).toEqual(nodes);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/nodes");
  });
});

// ===========================================================================
// REST API — getNode()
// ===========================================================================

describe("getNode()", () => {
  it("should call GET /nodes/:id and return NodeDetailResponse", async () => {
    const payload: NodeDetailResponse = {
      id: "n1",
      title: "Auth",
      status: "running",
      instructions: "Build auth module",
      delay: "0",
      retryCount: 0,
      maxRetries: 3,
      cost: 0.42,
      startedAt: "2026-01-01T00:00:00Z",
      agents: [],
      fileOwnership: {},
    };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: payload }));

    const client = createClient();
    const result = await client.getNode("n1");

    expect(result).toEqual(payload);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/nodes/n1");
  });

  it("should URL-encode the node ID", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: true, status: 200, body: { id: "node/special" } }),
    );

    const client = createClient();
    await client.getNode("node/special");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/nodes/node%2Fspecial");
  });
});

// ===========================================================================
// REST API — getSpecs()
// ===========================================================================

describe("getSpecs()", () => {
  it("should call GET /specs and return artifact names", async () => {
    const artifacts = [
      { name: "spec.md", path: "/proj/.loomflo/spec.md", size: 1024 },
      { name: "plan.md", path: "/proj/.loomflo/plan.md", size: 2048 },
    ];
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: { artifacts } }));

    const client = createClient();
    const result = await client.getSpecs();

    expect(result).toEqual(["spec.md", "plan.md"]);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/specs");
  });
});

// ===========================================================================
// REST API — getSpec()
// ===========================================================================

describe("getSpec()", () => {
  it("should call GET /specs/:name and return raw text content", async () => {
    const markdownContent = "# Spec\n\nThis is the spec.";
    const res = {
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(markdownContent),
    } as unknown as Response;
    mockFetch.mockResolvedValue(res);

    const client = createClient();
    const result = await client.getSpec("spec.md");

    expect(result).toBe(markdownContent);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/specs/spec.md");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-token");
  });

  it("should URL-encode the spec name", async () => {
    const res = {
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue("content"),
    } as unknown as Response;
    mockFetch.mockResolvedValue(res);

    const client = createClient();
    await client.getSpec("my spec.md");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/specs/my%20spec.md");
  });

  it("should throw LoomfloApiError on non-ok response", async () => {
    const res = {
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue("Not Found"),
    } as unknown as Response;
    mockFetch.mockResolvedValue(res);

    const client = createClient();

    try {
      await client.getSpec("missing.md");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LoomfloApiError);
      const apiErr = err as LoomfloApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.body).toBe("Not Found");
    }
  });
});

// ===========================================================================
// REST API — getCosts()
// ===========================================================================

describe("getCosts()", () => {
  it("should call GET /costs and return CostsResponse", async () => {
    const payload: CostsResponse = {
      total: 5.0,
      budgetLimit: 50,
      budgetRemaining: 45,
      nodes: [{ id: "n1", title: "Auth", cost: 3.0, retries: 1 }],
      loomCost: 2.0,
    };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: payload }));

    const client = createClient();
    const result = await client.getCosts();

    expect(result).toEqual(payload);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/costs");
  });
});

// ===========================================================================
// REST API — getConfig() / setConfig()
// ===========================================================================

describe("getConfig()", () => {
  it("should call GET /config and return config object", async () => {
    const config = { level: 2, budgetLimit: 100 };
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: config }));

    const client = createClient();
    const result = await client.getConfig();

    expect(result).toEqual(config);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/config");
    expect(init.method).toBe("GET");
  });
});

describe("setConfig()", () => {
  it("should call PUT /config with updates body", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: {} }));

    const updates = { budgetLimit: 200 };
    const client = createClient();
    await client.setConfig(updates);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(updates);
  });
});

// ===========================================================================
// REST API — getEvents()
// ===========================================================================

describe("getEvents()", () => {
  const eventsPayload: EventsResponse = {
    events: [
      {
        ts: "2026-01-01T00:00:00Z",
        type: "node_started",
        nodeId: "n1",
        agentId: null,
        details: {},
      },
    ],
    total: 1,
  };

  it("should call GET /events without query params when none provided", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: eventsPayload }));

    const client = createClient();
    const result = await client.getEvents();

    expect(result).toEqual(eventsPayload);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/events");
  });

  it("should append type query param", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: eventsPayload }));

    const client = createClient();
    await client.getEvents({ type: "node_started" });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("type=node_started");
  });

  it("should append nodeId query param", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: eventsPayload }));

    const client = createClient();
    await client.getEvents({ nodeId: "n1" });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("nodeId=n1");
  });

  it("should append limit and offset query params", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: eventsPayload }));

    const client = createClient();
    await client.getEvents({ limit: 10, offset: 20 });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=20");
  });

  it("should include all provided query params", async () => {
    mockFetch.mockResolvedValue(createMockResponse({ ok: true, status: 200, body: eventsPayload }));

    const client = createClient();
    await client.getEvents({ type: "node_started", nodeId: "n2", limit: 5, offset: 0 });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("type=node_started");
    expect(url).toContain("nodeId=n2");
    expect(url).toContain("limit=5");
    expect(url).toContain("offset=0");
  });
});

// ===========================================================================
// WebSocket — connect()
// ===========================================================================

describe("connect()", () => {
  it("should open a WebSocket and resolve on 'connected' event", async () => {
    const client = createClient({ port: 4000 });
    const connectPromise = client.connect();

    expect(capturedWebSockets).toHaveLength(1);
    const ws = capturedWebSockets[0];
    expect(ws.url).toBe("ws://127.0.0.1:4000/ws?token=test-token");

    // Simulate the server sending the welcome message
    ws._emit("message", { data: JSON.stringify({ type: "connected", message: "ok" }) });

    await expect(connectPromise).resolves.toBeUndefined();
  });

  it("should throw if already connected", async () => {
    const client = createClient();
    const connectPromise = client.connect();

    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    await expect(client.connect()).rejects.toThrow("WebSocket is already connected");
  });

  it("should reject on WebSocket error event", async () => {
    const client = createClient();
    const connectPromise = client.connect();

    const ws = capturedWebSockets[0];
    ws._emit("error");

    await expect(connectPromise).rejects.toThrow("WebSocket connection failed");
  });

  it("should reject if first message is not 'connected' type", async () => {
    const client = createClient();
    const connectPromise = client.connect();

    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "other_event" }) });

    await expect(connectPromise).rejects.toThrow("Unexpected first WebSocket message");
  });

  it("should reject if first message is not valid JSON", async () => {
    const client = createClient();
    const connectPromise = client.connect();

    const ws = capturedWebSockets[0];
    ws._emit("message", { data: "not-json{{" });

    await expect(connectPromise).rejects.toThrow("Failed to parse WebSocket welcome message");
  });

  it("should throw when global WebSocket is not available", async () => {
    vi.stubGlobal("WebSocket", undefined);

    const client = createClient();
    await expect(client.connect()).rejects.toThrow("Global WebSocket API is not available");
  });

  it("should URL-encode the token in the WebSocket URL", async () => {
    const client = createClient({ token: "token with spaces&special=chars" });
    const connectPromise = client.connect();

    const ws = capturedWebSockets[0];
    expect(ws.url).toContain("token=token%20with%20spaces%26special%3Dchars");

    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;
  });
});

// ===========================================================================
// WebSocket — disconnect()
// ===========================================================================

describe("disconnect()", () => {
  it("should close the WebSocket and set ws to null", async () => {
    const client = createClient();
    const connectPromise = client.connect();

    const ws = capturedWebSockets[0];
    const closeSpy = vi.spyOn(ws, "close");
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    client.disconnect();

    expect(closeSpy).toHaveBeenCalledOnce();
    const internals = client as unknown as Record<string, unknown>;
    expect(internals["ws"]).toBeNull();
  });

  it("should be a no-op when not connected", () => {
    const client = createClient();

    // Should not throw
    expect(() => {
      client.disconnect();
    }).not.toThrow();
  });

  it("should be safe to call multiple times", async () => {
    const client = createClient();
    const connectPromise = client.connect();

    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    expect(() => {
      client.disconnect();
      client.disconnect();
    }).not.toThrow();
  });
});

// ===========================================================================
// WebSocket — onEvent() and handleMessage()
// ===========================================================================

describe("onEvent()", () => {
  it("should register a listener and invoke it on matching events", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const handler = vi.fn();
    client.onEvent("node_status", handler);

    const event = { type: "node_status", nodeId: "n1", status: "running" };
    ws._emit("message", { data: JSON.stringify(event) });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should support multiple listeners for the same event type", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.onEvent("cost_update", handler1);
    client.onEvent("cost_update", handler2);

    const event = { type: "cost_update", totalCost: 1.5 };
    ws._emit("message", { data: JSON.stringify(event) });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("should not invoke listener for non-matching event types", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const handler = vi.fn();
    client.onEvent("node_status", handler);

    ws._emit("message", { data: JSON.stringify({ type: "cost_update", cost: 1 }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should return an unsubscribe function that removes the listener", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const handler = vi.fn();
    const unsub = client.onEvent("node_status", handler);
    unsub();

    ws._emit("message", {
      data: JSON.stringify({ type: "node_status", nodeId: "n1" }),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should clean up the listener set when the last listener is removed", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const unsub = client.onEvent("node_status", vi.fn());
    unsub();

    const listeners = (client as unknown as Record<string, unknown>)["listeners"] as Map<
      string,
      Set<unknown>
    >;
    expect(listeners.has("node_status")).toBe(false);
  });
});

// ===========================================================================
// handleMessage (private, via onEvent)
// ===========================================================================

describe("handleMessage (via onEvent)", () => {
  it("should silently ignore invalid JSON messages", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const handler = vi.fn();
    client.onEvent("node_status", handler);

    ws._emit("message", { data: "not-valid-json{{{" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should silently ignore messages without a type field", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const handler = vi.fn();
    client.onEvent("node_status", handler);

    ws._emit("message", { data: JSON.stringify({ nodeId: "n1" }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should silently ignore messages where type is not a string", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const handler = vi.fn();
    client.onEvent("node_status", handler);

    ws._emit("message", { data: JSON.stringify({ type: 42 }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should silently ignore null data", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const handler = vi.fn();
    client.onEvent("node_status", handler);

    ws._emit("message", { data: "null" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should dispatch events to correct listeners by type", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const nodeHandler = vi.fn();
    const costHandler = vi.fn();
    client.onEvent("node_status", nodeHandler);
    client.onEvent("cost_update", costHandler);

    ws._emit("message", {
      data: JSON.stringify({ type: "node_status", nodeId: "n1", status: "done" }),
    });
    ws._emit("message", {
      data: JSON.stringify({ type: "cost_update", totalCost: 2.0 }),
    });

    expect(nodeHandler).toHaveBeenCalledOnce();
    expect(costHandler).toHaveBeenCalledOnce();
    expect(nodeHandler).toHaveBeenCalledWith({
      type: "node_status",
      nodeId: "n1",
      status: "done",
    });
    expect(costHandler).toHaveBeenCalledWith({
      type: "cost_update",
      totalCost: 2.0,
    });
  });
});

// ===========================================================================
// WebSocket — close handler sets ws to null
// ===========================================================================

describe("WebSocket close handler", () => {
  it("should set ws to null when WebSocket closes", async () => {
    const client = createClient();
    const connectPromise = client.connect();
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ type: "connected" }) });
    await connectPromise;

    const internals = client as unknown as Record<string, unknown>;
    expect(internals["ws"]).not.toBeNull();

    ws._emit("close");

    expect(internals["ws"]).toBeNull();
  });
});
