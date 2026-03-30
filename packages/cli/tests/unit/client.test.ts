/**
 * Unit tests for packages/cli/src/client.ts — DaemonClient and readDaemonConfig.
 *
 * Covers daemon config loading, HTTP request methods, WebSocket lifecycle,
 * event subscription/unsubscription, and the static connect() factory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import {
  readDaemonConfig,
  DaemonClient,
  type ApiResponse,
  type WsNodeStatusEvent,
  type WsCostUpdateEvent,
} from "../../src/client.js";

// ---------------------------------------------------------------------------
// Mock typecasts
// ---------------------------------------------------------------------------

const mockReadFile = readFile as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

/** Minimal WebSocket mock supporting addEventListener, removeEventListener, close. */
class MockWebSocket {
  static readonly OPEN: number = 1;
  static readonly CLOSED: number = 3;

  readonly url: string;
  readyState: number = MockWebSocket.OPEN;
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(event: string, handler: (...args: unknown[]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  removeEventListener(event: string, handler: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  /** Test helper: fire a specific event to all registered listeners. */
  _emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

/** Create a mock Response with configurable status, headers, and body. */
function createMockResponse(options: {
  ok: boolean;
  status: number;
  contentType: string;
  body: unknown;
}): Response {
  const headers = new Headers({ "content-type": options.contentType });
  return {
    ok: options.ok,
    status: options.status,
    headers,
    json: vi.fn().mockResolvedValue(options.body),
    text: vi.fn().mockResolvedValue(
      typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    ),
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
  vi.stubGlobal(
    "WebSocket",
    class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        capturedWebSockets.push(this);
      }
    },
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ===========================================================================
// readDaemonConfig
// ===========================================================================

/** Tests for the readDaemonConfig() function that loads ~/.loomflo/daemon.json. */
describe("readDaemonConfig", () => {
  it("should return a valid DaemonConfig when daemon.json is well-formed", async () => {
    const config = { port: 4000, token: "abc123", pid: 999 };
    mockReadFile.mockResolvedValue(JSON.stringify(config));

    const result = await readDaemonConfig();

    expect(result).toEqual({ port: 4000, token: "abc123", pid: 999 });
  });

  it("should default pid to 0 when pid is not a number", async () => {
    const config = { port: 4000, token: "abc123" };
    mockReadFile.mockResolvedValue(JSON.stringify(config));

    const result = await readDaemonConfig();

    expect(result).toEqual({ port: 4000, token: "abc123", pid: 0 });
  });

  it("should throw when the daemon.json file does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await expect(readDaemonConfig()).rejects.toThrow(
      "Daemon not running — ~/.loomflo/daemon.json not found",
    );
  });

  it("should throw when daemon.json contains invalid JSON", async () => {
    mockReadFile.mockResolvedValue("not-json{{{");

    await expect(readDaemonConfig()).rejects.toThrow(
      "Invalid daemon.json — file is not valid JSON",
    );
  });

  it("should throw when daemon.json is missing the port field", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ token: "abc" }));

    await expect(readDaemonConfig()).rejects.toThrow(
      "Invalid daemon.json — missing port or token",
    );
  });

  it("should throw when daemon.json is missing the token field", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ port: 4000 }));

    await expect(readDaemonConfig()).rejects.toThrow(
      "Invalid daemon.json — missing port or token",
    );
  });

  it("should throw when daemon.json parses to null", async () => {
    mockReadFile.mockResolvedValue("null");

    await expect(readDaemonConfig()).rejects.toThrow(
      "Invalid daemon.json — missing port or token",
    );
  });
});

// ===========================================================================
// DaemonClient — constructor
// ===========================================================================

/** Tests for the DaemonClient constructor. */
describe("DaemonClient constructor", () => {
  it("should store the correct baseUrl and token", () => {
    const client = new DaemonClient(3000, "secret-token");

    // Access private fields via type-safe index for verification
    expect((client as unknown as Record<string, unknown>)["baseUrl"]).toBe(
      "http://127.0.0.1:3000",
    );
    expect((client as unknown as Record<string, unknown>)["token"]).toBe("secret-token");
  });
});

// ===========================================================================
// DaemonClient.connect()
// ===========================================================================

/** Tests for the static DaemonClient.connect() factory method. */
describe("DaemonClient.connect", () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(JSON.stringify({ port: 5000, token: "t1", pid: 1 }));
  });

  it("should call readDaemonConfig and return a DaemonClient instance", async () => {
    const client = await DaemonClient.connect();

    expect(mockReadFile).toHaveBeenCalled();
    expect(client).toBeInstanceOf(DaemonClient);
    expect((client as unknown as Record<string, unknown>)["baseUrl"]).toBe(
      "http://127.0.0.1:5000",
    );
  });

  it("should not open a WebSocket by default", async () => {
    await DaemonClient.connect();

    expect(capturedWebSockets).toHaveLength(0);
  });

  it("should open a WebSocket when websocket option is true", async () => {
    await DaemonClient.connect({ websocket: true });

    expect(capturedWebSockets).toHaveLength(1);
    expect(capturedWebSockets[0].url).toBe("ws://127.0.0.1:5000/ws?token=t1");
  });
});

// ===========================================================================
// DaemonClient HTTP methods
// ===========================================================================

/** Tests for the DaemonClient HTTP request methods (get, post, put, delete). */
describe("DaemonClient HTTP methods", () => {
  let client: DaemonClient;

  beforeEach(() => {
    client = new DaemonClient(3000, "test-token");
  });

  /** Tests for DaemonClient.get(). */
  describe("get", () => {
    it("should send a GET request and return the parsed API response", async () => {
      const body = { workflows: [] };
      mockFetch.mockResolvedValue(
        createMockResponse({ ok: true, status: 200, contentType: "application/json", body }),
      );

      const result: ApiResponse<{ workflows: unknown[] }> = await client.get("/workflow");

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toEqual(body);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:3000/workflow");
      expect(init.method).toBe("GET");
    });
  });

  /** Tests for DaemonClient.post(). */
  describe("post", () => {
    it("should send a POST request with JSON body and Content-Type header", async () => {
      const reqBody = { name: "test-workflow" };
      const resBody = { id: "wf-1" };
      mockFetch.mockResolvedValue(
        createMockResponse({ ok: true, status: 201, contentType: "application/json", body: resBody }),
      );

      const result = await client.post("/workflow", reqBody);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      expect(result.data).toEqual(resBody);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(reqBody));
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });
  });

  /** Tests for DaemonClient.put(). */
  describe("put", () => {
    it("should send a PUT request with JSON body", async () => {
      const reqBody = { status: "paused" };
      mockFetch.mockResolvedValue(
        createMockResponse({ ok: true, status: 200, contentType: "application/json", body: { ok: true } }),
      );

      const result = await client.put("/workflow/wf-1", reqBody);

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ ok: true });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("PUT");
      expect(init.body).toBe(JSON.stringify(reqBody));
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });
  });

  /** Tests for DaemonClient.delete(). */
  describe("delete", () => {
    it("should send a DELETE request", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ ok: true, status: 204, contentType: "text/plain", body: "" }),
      );

      const result = await client.delete("/workflow/wf-1");

      expect(result.ok).toBe(true);
      expect(result.status).toBe(204);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:3000/workflow/wf-1");
      expect(init.method).toBe("DELETE");
    });
  });
});

// ===========================================================================
// DaemonClient.request() — detailed behavior
// ===========================================================================

/** Tests for the low-level DaemonClient.request() method. */
describe("DaemonClient.request", () => {
  let client: DaemonClient;

  beforeEach(() => {
    client = new DaemonClient(3000, "auth-tok");
  });

  it("should set the Authorization header with Bearer token", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: true, status: 200, contentType: "application/json", body: {} }),
    );

    await client.request({ method: "GET", path: "/health" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer auth-tok");
  });

  it("should parse JSON response when content-type is application/json", async () => {
    const body = { status: "healthy" };
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: true, status: 200, contentType: "application/json", body }),
    );

    const result = await client.request<{ status: string }>({ method: "GET", path: "/health" });

    expect(result.data).toEqual(body);
  });

  it("should parse text response when content-type is not application/json", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: false, status: 500, contentType: "text/plain", body: "Internal Error" }),
    );

    const result = await client.request<string>({ method: "GET", path: "/fail" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.data).toBe("Internal Error");
  });

  it("should return ok=false for non-2xx responses", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: false, status: 404, contentType: "application/json", body: { error: "not found" } }),
    );

    const result = await client.request({ method: "GET", path: "/missing" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.data).toEqual({ error: "not found" });
  });

  it("should not set Content-Type or body for GET requests even if body is provided", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: true, status: 200, contentType: "application/json", body: {} }),
    );

    await client.request({ method: "GET", path: "/test", body: { ignored: true } });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("should merge extra headers with Authorization", async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({ ok: true, status: 200, contentType: "application/json", body: {} }),
    );

    await client.request({
      method: "GET",
      path: "/test",
      headers: { "X-Custom": "value" },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer auth-tok");
    expect(headers["X-Custom"]).toBe("value");
  });
});

// ===========================================================================
// DaemonClient.connectWebSocket()
// ===========================================================================

/** Tests for the WebSocket connection lifecycle. */
describe("DaemonClient.connectWebSocket", () => {
  let client: DaemonClient;

  beforeEach(() => {
    client = new DaemonClient(8080, "ws-token");
  });

  it("should create a WebSocket with the correct URL including token", () => {
    client.connectWebSocket();

    expect(capturedWebSockets).toHaveLength(1);
    expect(capturedWebSockets[0].url).toBe("ws://127.0.0.1:8080/ws?token=ws-token");
  });

  it("should set up open, message, close, and error event listeners", () => {
    client.connectWebSocket();
    const ws = capturedWebSockets[0];

    // Verify all four listeners were registered
    const listenerMap = (ws as unknown as Record<string, unknown>)["listeners"] as Map<
      string,
      Set<unknown>
    >;
    expect(listenerMap.has("open")).toBe(true);
    expect(listenerMap.has("message")).toBe(true);
    expect(listenerMap.has("close")).toBe(true);
    expect(listenerMap.has("error")).toBe(true);
  });

  it("should be a no-op when a WebSocket is already active", () => {
    client.connectWebSocket();
    client.connectWebSocket();

    expect(capturedWebSockets).toHaveLength(1);
  });

  it("should be a no-op after disconnect", () => {
    client.disconnect();
    client.connectWebSocket();

    expect(capturedWebSockets).toHaveLength(0);
  });

  it("should schedule reconnection on unexpected close", () => {
    client.connectWebSocket();
    const ws = capturedWebSockets[0];
    ws._emit("close");

    // Advance past the initial reconnect delay (500ms)
    vi.advanceTimersByTime(500);

    expect(capturedWebSockets).toHaveLength(2);
  });

  it("should not reconnect on close after intentional disconnect", () => {
    client.connectWebSocket();
    const ws = capturedWebSockets[0];
    client.disconnect();
    ws._emit("close");

    vi.advanceTimersByTime(60_000);

    // Only the original WebSocket should have been created
    expect(capturedWebSockets).toHaveLength(1);
  });
});

// ===========================================================================
// DaemonClient.on / off — event subscriptions
// ===========================================================================

/** Tests for event handler registration and removal. */
describe("DaemonClient event subscriptions", () => {
  let client: DaemonClient;

  beforeEach(() => {
    client = new DaemonClient(3000, "tok");
    client.connectWebSocket();
  });

  it("should call registered handler when a matching event arrives", () => {
    const handler = vi.fn();
    client.on("node_status", handler);

    const event: WsNodeStatusEvent = {
      type: "node_status",
      nodeId: "n1",
      status: "running",
      title: "Build",
      timestamp: "2026-03-30T00:00:00Z",
    };
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify(event) });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should support multiple handlers for the same event type", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.on("cost_update", handler1);
    client.on("cost_update", handler2);

    const event: WsCostUpdateEvent = {
      type: "cost_update",
      nodeId: "n1",
      agentId: "a1",
      callCost: 0.01,
      nodeCost: 0.05,
      totalCost: 1.0,
      budgetRemaining: 9.0,
      timestamp: "2026-03-30T00:00:00Z",
    };
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify(event) });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("should remove a specific handler via the returned unsubscribe function", () => {
    const handler = vi.fn();
    const unsub = client.on("node_status", handler);
    unsub();

    const event: WsNodeStatusEvent = {
      type: "node_status",
      nodeId: "n1",
      status: "done",
      title: "Test",
      timestamp: "2026-03-30T00:00:00Z",
    };
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify(event) });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should remove all handlers for a specific event type via off(eventType)", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    client.on("node_status", h1);
    client.on("node_status", h2);

    client.off("node_status");

    const event: WsNodeStatusEvent = {
      type: "node_status",
      nodeId: "n1",
      status: "done",
      title: "X",
      timestamp: "2026-03-30T00:00:00Z",
    };
    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify(event) });

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it("should remove all handlers via off() with no arguments", () => {
    client.on("node_status", vi.fn());
    client.on("cost_update", vi.fn());

    client.off();

    const handlers = (client as unknown as Record<string, unknown>)["handlers"] as Map<
      string,
      Set<unknown>
    >;
    expect(handlers.size).toBe(0);
  });

  it("should silently ignore messages with invalid JSON", () => {
    const handler = vi.fn();
    client.on("node_status", handler);

    const ws = capturedWebSockets[0];
    ws._emit("message", { data: "not-json{{{" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should silently ignore messages without a type field", () => {
    const handler = vi.fn();
    client.on("node_status", handler);

    const ws = capturedWebSockets[0];
    ws._emit("message", { data: JSON.stringify({ nodeId: "n1" }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should not throw if a handler throws", () => {
    client.on("node_status", () => {
      throw new Error("handler error");
    });

    const event: WsNodeStatusEvent = {
      type: "node_status",
      nodeId: "n1",
      status: "running",
      title: "B",
      timestamp: "2026-03-30T00:00:00Z",
    };
    const ws = capturedWebSockets[0];

    expect(() => {
      ws._emit("message", { data: JSON.stringify(event) });
    }).not.toThrow();
  });
});

// ===========================================================================
// DaemonClient.disconnect()
// ===========================================================================

/** Tests for the DaemonClient.disconnect() method. */
describe("DaemonClient.disconnect", () => {
  it("should close the WebSocket and clear all handlers", () => {
    const client = new DaemonClient(3000, "tok");
    client.connectWebSocket();
    client.on("node_status", vi.fn());

    const ws = capturedWebSockets[0];
    client.disconnect();

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    const handlers = (client as unknown as Record<string, unknown>)["handlers"] as Map<
      string,
      Set<unknown>
    >;
    expect(handlers.size).toBe(0);
  });

  it("should set closed=true", () => {
    const client = new DaemonClient(3000, "tok");
    client.disconnect();

    expect((client as unknown as Record<string, unknown>)["closed"]).toBe(true);
  });

  it("should cancel a pending reconnect timer", () => {
    const client = new DaemonClient(3000, "tok");
    client.connectWebSocket();

    const ws = capturedWebSockets[0];
    ws._emit("close"); // triggers reconnect scheduling

    client.disconnect();

    // Advancing timers should not create a new WebSocket
    vi.advanceTimersByTime(60_000);
    expect(capturedWebSockets).toHaveLength(1);
  });

  it("should be safe to call multiple times", () => {
    const client = new DaemonClient(3000, "tok");
    client.connectWebSocket();

    expect(() => {
      client.disconnect();
      client.disconnect();
    }).not.toThrow();
  });
});

// ===========================================================================
// DaemonClient.connected getter
// ===========================================================================

/** Tests for the connected getter property. */
describe("DaemonClient.connected", () => {
  it("should return true when ws.readyState is WebSocket.OPEN", () => {
    const client = new DaemonClient(3000, "tok");
    client.connectWebSocket();

    // The mock WebSocket defaults to OPEN
    expect(client.connected).toBe(true);
  });

  it("should return false when no WebSocket is connected", () => {
    const client = new DaemonClient(3000, "tok");

    expect(client.connected).toBe(false);
  });

  it("should return false after WebSocket is closed", () => {
    const client = new DaemonClient(3000, "tok");
    client.connectWebSocket();
    client.disconnect();

    expect(client.connected).toBe(false);
  });

  it("should return false when ws.readyState is not OPEN", () => {
    const client = new DaemonClient(3000, "tok");
    client.connectWebSocket();

    const ws = capturedWebSockets[0];
    ws.readyState = 0; // CONNECTING

    expect(client.connected).toBe(false);
  });
});
