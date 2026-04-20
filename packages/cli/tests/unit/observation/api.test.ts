/**
 * Unit tests for packages/cli/src/observation/api.ts — httpGet + fetchProjectsRuntime.
 *
 * Mocks the global fetch to verify request construction and response aggregation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("httpGet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sends GET with Bearer token and returns parsed JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hello: "world" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { httpGet } = await import("../../../src/observation/api.js");
    const result = await httpGet<{ hello: string }>("/test", { port: 9000, token: "tok" });

    expect(result).toEqual({ hello: "world" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9000/test",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
        }),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    vi.stubGlobal("fetch", mockFetch);

    const { httpGet } = await import("../../../src/observation/api.js");
    await expect(httpGet("/missing", { port: 9000, token: "tok" })).rejects.toThrow(/404/);
  });
});

describe("fetchProjectsRuntime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("aggregates /projects + /projects/:id/workflow in parallel", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "proj_a", name: "alpha", projectPath: "/a" },
          { id: "proj_b", name: "beta", projectPath: "/b" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "running",
          graph: { topology: ["n1", "n2"] },
          currentNodeId: "n1",
          totalCost: 0.42,
          startedAt: "2026-04-15T00:00:00Z",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "idle",
          graph: { topology: [] },
          currentNodeId: null,
          totalCost: 0,
          startedAt: null,
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const { fetchProjectsRuntime } = await import("../../../src/observation/api.js");
    const daemon = { port: 42000, token: "t" };
    const out = await fetchProjectsRuntime(daemon);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: "proj_a",
      name: "alpha",
      projectPath: "/a",
      status: "running",
      cost: 0.42,
      nodeCount: 2,
      currentNodeId: "n1",
    });
    expect(out[1]).toMatchObject({
      id: "proj_b",
      name: "beta",
      projectPath: "/b",
      status: "idle",
      cost: 0,
      nodeCount: 0,
      currentNodeId: null,
    });
    // uptimeSec should be a number for running, 0 for idle with no startedAt
    expect(typeof out[0]!.uptimeSec).toBe("number");
    expect(out[0]!.uptimeSec).toBeGreaterThan(0);
    expect(out[1]!.uptimeSec).toBe(0);
  });

  it("tolerates a single project's workflow endpoint failing and marks it unknown", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "proj_a", name: "alpha", projectPath: "/a" }],
      })
      .mockRejectedValueOnce(new Error("404 not found"));
    vi.stubGlobal("fetch", mockFetch);

    const { fetchProjectsRuntime } = await import("../../../src/observation/api.js");
    const out = await fetchProjectsRuntime({ port: 42000, token: "t" });
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe("unknown");
    expect(out[0]!.id).toBe("proj_a");
    expect(out[0]!.cost).toBe(0);
  });

  it("returns empty array when /projects returns empty list", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal("fetch", mockFetch);

    const { fetchProjectsRuntime } = await import("../../../src/observation/api.js");
    const out = await fetchProjectsRuntime({ port: 42000, token: "t" });
    expect(out).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
