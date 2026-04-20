import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type ApiClient } from "../../src/lib/api.js";

const makeClient = (): ApiClient =>
  api({ baseUrl: "http://localhost:42000", token: "t" });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("listProjects() hits GET /projects with auth header", async () => {
    await makeClient().listProjects();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:42000/projects");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer t");
  });

  it("getWorkflow(id) scopes URL under /projects/:id/workflow", async () => {
    await makeClient().getWorkflow("proj_x");
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:42000/projects/proj_x/workflow");
  });

  it("getNodes / getNode / getEvents / getCosts / getConfig / getMemory / getSpecs all scope under /projects/:id", async () => {
    const c = makeClient();
    await c.getNodes("proj_x");
    await c.getNode("proj_x", "n1");
    await c.getEvents("proj_x");
    await c.getCosts("proj_x");
    await c.getConfig("proj_x");
    await c.getMemory("proj_x");
    await c.getSpecs("proj_x");
    const urls = fetchSpy.mock.calls.map((call) => call[0] as string);
    for (const u of urls) {
      expect(u).toMatch(/\/projects\/proj_x\//);
    }
  });

  it("throws a DashboardOutdatedError on 410 Gone", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: "gone", newRoute: "/projects/.../nodes" }), { status: 410 }));
    await expect(makeClient().getNodes("proj_x")).rejects.toThrow(/outdated/i);
  });

  it("postChat scopes under /projects/:id/chat and sends body", async () => {
    await makeClient().postChat("proj_x", { messages: [{ role: "user", content: "hi" }] });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:42000/projects/proj_x/chat");
    expect(init.method).toBe("POST");
  });
});
