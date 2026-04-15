import { describe, it, expect } from "vitest";
import { createServer } from "../../src/api/server.js";

describe("GET /daemon/status", () => {
  it("returns port, pid, version, uptimeMs and projectCount", async () => {
    const { server } = await createServer({
      token: "t",
      projectPath: "/tmp",
      dashboardPath: null,
      listProjects: () => [],
      getRuntime: () => null,
      daemonPort: 3123,
      health: { getUptime: () => 42, getWorkflow: () => null },
      workflow: {
        getWorkflow: () => null,
        setWorkflow: () => undefined,
        getProvider: () => {
          throw new Error("no provider");
        },
        getEventLog: () => ({ append: async () => undefined, query: async () => [] }),
        getSharedMemory: () => ({}) as never,
        getCostTracker: () => ({}) as never,
      },
      events: { getProjectPath: () => "/tmp" },
      onShutdown: () => undefined,
    });
    const res = await server.inject({
      method: "GET",
      url: "/daemon/status",
      headers: { authorization: "Bearer t" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.port).toBe(3123);
    expect(body.version).toBe("0.2.0");
    expect(body.projectCount).toBe(0);
    expect(typeof body.uptimeMs).toBe("number");
    expect(typeof body.pid).toBe("number");
    await server.close();
  });
});
