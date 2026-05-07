import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, DashboardOutdatedError } from "../../src/lib/api.js";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function mockFetch(impl: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return impl(call);
  }) as unknown as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/markdown" },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const BASE = "http://daemon.test";
function client(opts: Partial<{ token: string; useMock: boolean }> = {}): ApiClient {
  return new ApiClient({
    baseUrl: BASE,
    token: opts.token ?? "tok",
    ...(opts.useMock !== undefined ? { useMock: opts.useMock } : {}),
  });
}

describe("ApiClient — base behaviour", () => {
  it("sends Authorization: Bearer <token>", async () => {
    const calls = mockFetch(() => jsonResponse({ ok: true, uptime: 1 }));
    await client().health();
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });

  it("strips trailing slashes from baseUrl", async () => {
    const calls = mockFetch(() => jsonResponse({ ok: true, uptime: 0 }));
    const c = new ApiClient({ baseUrl: "http://foo//", token: "" });
    await c.health();
    expect(calls[0]!.url).toBe("http://foo/health");
  });

  it("sets Content-Type when body is provided", async () => {
    const calls = mockFetch(() => jsonResponse({ status: "ok" }));
    await client().startWorkflow("p");
    const headers = calls[0]!.init.headers as Record<string, string>;
    // POST without body → no Content-Type yet
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("sets Content-Type when body is provided (PUT)", async () => {
    const calls = mockFetch(() =>
      jsonResponse({ credential: { name: "n", type: "anthropic-oauth" } }),
    );
    await client().upsertCredential("openai", { type: "anthropic-oauth" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws ApiError on non-2xx", async () => {
    mockFetch(() => jsonResponse({ message: "nope" }, { status: 500 }));
    await expect(client().health()).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiError including the body when JSON", async () => {
    mockFetch(() => jsonResponse({ message: "nope" }, { status: 404 }));
    try {
      await client().health();
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(404);
      expect(err.body).toEqual({ message: "nope" });
    }
  });

  it("safeBody returns undefined when both json and text fail (consumed stream)", async () => {
    mockFetch(() => new Response("plain error", { status: 500 }));
    try {
      await client().health();
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as ApiError;
      // json() fails → text() on the same already-consumed Response also fails → undefined
      expect(err.body).toBeUndefined();
      expect(err.status).toBe(500);
    }
  });

  it("throws DashboardOutdatedError on HTTP 410", async () => {
    mockFetch(() => jsonResponse({ newRoute: "/v2/health" }, { status: 410 }));
    try {
      await client().health();
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DashboardOutdatedError);
      expect((e as DashboardOutdatedError).newRoute).toBe("/v2/health");
    }
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    const result = await client().deleteProject("p1");
    expect(result).toBeUndefined();
  });

  it("exposes baseUrlValue / tokenValue / useMock getters", () => {
    const c = client({ useMock: true });
    expect(c.baseUrlValue).toBe(BASE);
    expect(c.tokenValue).toBe("tok");
    expect(c.useMock).toBe(true);
  });
});

describe("ApiClient — endpoint coverage", () => {
  it("daemonStatus", async () => {
    const calls = mockFetch(() =>
      jsonResponse({ port: 1, pid: 2, version: "1.0.0", uptimeMs: 0, projectCount: 0 }),
    );
    await client().daemonStatus();
    expect(calls[0]!.url).toBe(`${BASE}/daemon/status`);
  });

  it("listRuntimes", async () => {
    const calls = mockFetch(() => jsonResponse({ runtimes: [] }));
    await client().listRuntimes();
    expect(calls[0]!.url).toBe(`${BASE}/runtimes`);
  });

  it("runtimeAvailability — real route", async () => {
    const calls = mockFetch(() => jsonResponse({ clis: {} }));
    await client().runtimeAvailability();
    expect(calls[0]!.url).toBe(`${BASE}/runtimes/availability`);
  });

  it("runtimeAvailability — mock reroute", async () => {
    const calls = mockFetch(() => jsonResponse({ clis: {} }));
    await client({ useMock: true }).runtimeAvailability();
    expect(calls[0]!.url).toBe(`${BASE}/mock/runtimes/availability`);
  });

  it("runtimeAvailabilityFor / runtimeModels encode the name", async () => {
    const calls = mockFetch(() => jsonResponse({ installed: false, authenticated: false }));
    await client().runtimeAvailabilityFor("claude code");
    expect(calls[0]!.url).toBe(`${BASE}/runtimes/claude%20code/availability`);
    mockFetch(() => jsonResponse({ models: [] }));
    await client().runtimeModels("claude/code");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe(
      `${BASE}/runtimes/claude%2Fcode/models`,
    );
  });

  it("listCredentials / upsertCredential / deleteCredential", async () => {
    const calls = mockFetch((c) => {
      if (c.init.method === "PUT") return jsonResponse({ credential: { name: "x", type: "anthropic-oauth" } });
      if (c.init.method === "DELETE") return new Response(null, { status: 204 });
      return jsonResponse({ credentials: [] });
    });
    await client().listCredentials();
    await client().upsertCredential("x", { type: "anthropic-oauth" });
    await client().deleteCredential("x");
    expect(calls.map((c) => c.init.method ?? "GET")).toEqual(["GET", "PUT", "DELETE"]);
    expect(calls[1]!.init.body).toBe(JSON.stringify({ type: "anthropic-oauth" }));
  });

  it("listProjects — real path", async () => {
    const calls = mockFetch(() => jsonResponse([]));
    await client().listProjects();
    expect(calls[0]!.url).toBe(`${BASE}/projects`);
  });

  it("listProjects — mock returns the unwrapped array", async () => {
    mockFetch(() => jsonResponse({ projects: [{ id: "p1" }] }));
    const result = await client({ useMock: true }).listProjects();
    expect(result).toEqual([{ id: "p1" }]);
  });

  it("createProject sends a POST with JSON body", async () => {
    const calls = mockFetch(() => jsonResponse({ id: "p1" }));
    await client().createProject({
      id: "proj_aaaaaaaa",
      name: "n",
      projectPath: "/tmp",
      providerProfileId: "default",
    });
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      id: "proj_aaaaaaaa",
      name: "n",
      projectPath: "/tmp",
      providerProfileId: "default",
    });
  });

  it("getProject / deleteProject use the encoded id", async () => {
    const calls = mockFetch(() => jsonResponse({ id: "x" }));
    await client().getProject("a/b");
    expect(calls[0]!.url).toBe(`${BASE}/projects/a%2Fb`);
    mockFetch(() => new Response(null, { status: 204 }));
    await client().deleteProject("a/b");
  });

  it("getWorkflow — real path", async () => {
    const calls = mockFetch(() => jsonResponse({ id: "w" }));
    await client().getWorkflow("p1");
    expect(calls[0]!.url).toBe(`${BASE}/projects/p1/workflow`);
  });

  it("getWorkflow — mock reroute unwraps { workflow }", async () => {
    mockFetch(() => jsonResponse({ workflow: { id: "w" } }));
    const result = await client({ useMock: true }).getWorkflow("p1");
    expect(result).toEqual({ id: "w" });
  });

  it("workflow lifecycle endpoints all POST", async () => {
    const calls = mockFetch(() => jsonResponse({ status: "ok" }));
    await client().initWorkflow("p1", { description: "d", projectPath: "/tmp" });
    await client().startWorkflow("p1");
    await client().pauseWorkflow("p1");
    await client().resumeWorkflow("p1");
    expect(calls.map((c) => c.init.method)).toEqual(["POST", "POST", "POST", "POST"]);
    expect(calls[0]!.url).toContain("/workflow/init");
    expect(calls[1]!.url).toContain("/workflow/start");
    expect(calls[2]!.url).toContain("/workflow/pause");
    expect(calls[3]!.url).toContain("/workflow/resume");
  });

  it("getEvents — real path with query string", async () => {
    const calls = mockFetch(() => jsonResponse({ events: [], total: 0 }));
    await client().getEvents("p1", { type: "node_started", nodeId: "n1", limit: 10, offset: 5 });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/projects/p1/events");
    expect(url.searchParams.get("type")).toBe("node_started");
    expect(url.searchParams.get("nodeId")).toBe("n1");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("5");
  });

  it("getEvents — mock unwrap", async () => {
    mockFetch(() => jsonResponse({ events: [{ ts: "t" }] }));
    const result = await client({ useMock: true }).getEvents("p1");
    expect(result.total).toBe(1);
  });

  it("postChat / getChatHistory", async () => {
    const calls = mockFetch((c) =>
      c.init.method === "POST"
        ? jsonResponse({ response: "hi", action: null, category: "answer" })
        : jsonResponse({ messages: [] }),
    );
    await client().postChat("p1", "hello");
    await client().getChatHistory("p1");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ message: "hello" });
    expect(calls[1]!.url).toContain("/chat/history");
  });

  it("listNodes / getNode / getReview", async () => {
    const calls = mockFetch(() => jsonResponse([]));
    await client().listNodes("p1");
    await client().getNode("p1", "n1");
    await client().getReview("p1", "n1");
    expect(calls[0]!.url).toContain("/projects/p1/nodes");
    expect(calls[1]!.url).toContain("/projects/p1/nodes/n1");
    expect(calls[2]!.url).toContain("/projects/p1/nodes/n1/review");
  });

  it("listMemory / readMemory", async () => {
    const calls = mockFetch((c) => {
      if (c.url.endsWith("/memory")) return jsonResponse({ files: [] });
      return textResponse("# hello");
    });
    await client().listMemory("p1");
    const md = await client().readMemory("p1", "summary");
    expect(md).toBe("# hello");
    expect(calls[1]!.url).toContain("/memory/summary");
  });

  it("getCosts", async () => {
    const calls = mockFetch(() => jsonResponse({ total: 0, budgetLimit: null, budgetRemaining: null, nodes: [], loomCost: 0 }));
    await client().getCosts("p1");
    expect(calls[0]!.url).toBe(`${BASE}/projects/p1/costs`);
  });

  it("getConfig / updateConfig", async () => {
    const calls = mockFetch((c) => jsonResponse({ config: { level: 1 } }));
    await client().getConfig("p1");
    await client().updateConfig("p1", { level: 2 });
    expect(calls[1]!.init.method).toBe("PUT");
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ level: 2 });
  });

  it("listSpecs / readSpec", async () => {
    const calls = mockFetch((c) => {
      if (c.url.endsWith("/specs")) return jsonResponse({ artifacts: [] });
      return textResponse("# spec");
    });
    await client().listSpecs("p1");
    expect(await client().readSpec("p1", "vision")).toBe("# spec");
    expect(calls[1]!.url).toContain("/specs/vision");
  });

  it("listMcp / upsertMcp / deleteMcp", async () => {
    const calls = mockFetch((c) => {
      if (c.init.method === "PUT") return jsonResponse({ server: { type: "stdio", enabled: true } });
      if (c.init.method === "DELETE") return new Response(null, { status: 204 });
      return jsonResponse({ servers: {} });
    });
    await client().listMcp("p1");
    await client().upsertMcp("p1", "filesystem", { type: "stdio", enabled: true });
    await client().deleteMcp("p1", "filesystem");
    expect(calls.map((c) => c.init.method ?? "GET")).toEqual(["GET", "PUT", "DELETE"]);
  });

  it("mockSeed", async () => {
    const calls = mockFetch(() =>
      jsonResponse({ workflow: {}, events: [], projects: [], clis: {} }),
    );
    await client().mockSeed();
    expect(calls[0]!.url).toBe(`${BASE}/mock/seed`);
  });
});

describe("requestText error path", () => {
  it("throws ApiError on non-2xx for text endpoints", async () => {
    mockFetch(() => new Response("boom", { status: 500 }));
    await expect(client().readSpec("p1", "x")).rejects.toBeInstanceOf(ApiError);
  });
});
