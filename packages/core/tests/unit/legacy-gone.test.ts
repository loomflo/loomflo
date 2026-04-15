import { describe, it, expect } from "vitest";
import { createServer } from "../../src/api/server.js";

describe("legacy routes return 410 Gone", () => {
  it.each([
    ["POST", "/workflow/start"],
    ["POST", "/workflow/init"],
    ["POST", "/workflow/pause"],
    ["POST", "/workflow/resume"],
    ["POST", "/workflow/stop"],
    ["GET", "/workflow"],
    ["GET", "/events"],
    ["GET", "/nodes"],
    ["POST", "/chat"],
    ["GET", "/config"],
  ])("%s %s → 410", async (method, url) => {
    const { server } = await createServer({
      token: "t",
      projectPath: "/tmp",
      dashboardPath: null,
    });
    const res = await server.inject({
      method: method as "GET" | "POST",
      url,
      headers: { authorization: "Bearer t" },
    });
    expect(res.statusCode).toBe(410);
    const body = res.json() as Record<string, unknown>;
    expect(body["error"]).toBe("route_moved");
    expect(typeof body["newRoute"]).toBe("string");
    await server.close();
  });
});
