/**
 * Unit tests for /runtimes routes + cli-detection.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { runtimesRoutes } from "../../src/api/routes/runtimes.js";
import { detectAgentCli } from "../../src/api/cli-detection.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify();
  await app.register(runtimesRoutes);
  await app.ready();
  return app;
}

describe("GET /runtimes", () => {
  it("returns the four known runtimes with their capabilities", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/runtimes" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { runtimes: { name: string; registered: boolean }[] };
      const names = body.runtimes.map((r) => r.name).sort();
      expect(names).toEqual(["claude-agent", "copilot", "loomi-native", "mock"]);
      // legacy is not registered, others are
      const legacy = body.runtimes.find((r) => r.name === "loomi-native");
      expect(legacy?.registered).toBe(false);
      const claude = body.runtimes.find((r) => r.name === "claude-agent");
      expect(claude?.registered).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("GET /runtimes/:name/models", () => {
  it("returns the claude-agent model catalog", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/runtimes/claude-agent/models" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { models: { id: string }[] };
      expect(body.models.some((m) => m.id === "claude-sonnet-4-6")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("returns the copilot model catalog", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/runtimes/copilot/models" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { models: { id: string }[] };
      expect(body.models.some((m) => m.id === "gpt-5")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("returns 404 for an unknown runtime", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/runtimes/does-not-exist/models" });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe("GET /runtimes/:name/availability", () => {
  it("returns 404 for an unknown runtime", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/runtimes/does-not-exist/availability",
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("returns trivial availability for runtimes without a CLI dependency", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/runtimes/loomi-native/availability",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { installed: boolean; authenticated: boolean; cli: string | null };
      expect(body.installed).toBe(true);
      expect(body.cli).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe("detectAgentCli", () => {
  it("returns installed=false when the binary cannot be found", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "loomflo-detect-"));
    try {
      const result = await detectAgentCli("claude-code", {
        env: { LOOMFLO_CLAUDE_CODE_PATH: "/nonexistent/loomflo-fake-binary" },
        homeDir: fakeHome,
        timeoutMs: 500,
      });
      expect(result.installed).toBe(false);
      expect(result.authenticated).toBe(false);
      expect(result.version).toBeUndefined();
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("reports authenticated=false when the credentials artifact is missing", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "loomflo-detect-noauth-"));
    try {
      const result = await detectAgentCli("copilot", {
        env: { LOOMFLO_COPILOT_CLI_PATH: "/nonexistent/fake" },
        homeDir: fakeHome,
        timeoutMs: 500,
      });
      // Not installed = automatically not authenticated.
      expect(result.installed).toBe(false);
      expect(result.authenticated).toBe(false);
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
