/**
 * Unit tests for /mock/* fixture routes (Phase 4c).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mockRoutes, isMockApiEnabled } from "../../src/api/routes/mock.js";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  app = Fastify();
  await app.register(mockRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("isMockApiEnabled", () => {
  it("returns true only when LOOMFLO_MOCK_API=1", () => {
    expect(isMockApiEnabled({})).toBe(false);
    expect(isMockApiEnabled({ LOOMFLO_MOCK_API: "0" })).toBe(false);
    expect(isMockApiEnabled({ LOOMFLO_MOCK_API: "true" })).toBe(false);
    expect(isMockApiEnabled({ LOOMFLO_MOCK_API: "1" })).toBe(true);
  });
});

describe("GET /mock/workflow", () => {
  it("returns a Workflow with at least one running node", async () => {
    const res = await app.inject({ method: "GET", url: "/mock/workflow" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { workflow: { graph: { nodes: Record<string, unknown> } } };
    const nodes = Object.values(body.workflow.graph.nodes);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    expect(
      nodes.some((n) => (n as { status: string }).status === "running"),
    ).toBe(true);
  });
});

describe("GET /mock/events", () => {
  it("returns a non-empty event log", async () => {
    const res = await app.inject({ method: "GET", url: "/mock/events" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[] };
    expect(body.events.length).toBeGreaterThan(0);
  });
});

describe("GET /mock/projects", () => {
  it("returns multiple projects with paths", async () => {
    const res = await app.inject({ method: "GET", url: "/mock/projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { projects: { projectPath: string }[] };
    expect(body.projects.length).toBeGreaterThanOrEqual(2);
    expect(body.projects[0]?.projectPath.length).toBeGreaterThan(0);
  });
});

describe("GET /mock/runtimes/availability", () => {
  it("reports per-CLI installed/authenticated state", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/mock/runtimes/availability",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      clis: Record<string, { installed: boolean; authenticated: boolean }>;
    };
    expect(body.clis["claude-code"]?.installed).toBe(true);
    expect(body.clis["copilot"]?.authenticated).toBe(false);
    expect(body.clis["codex"]?.installed).toBe(false);
  });
});

describe("GET /mock/seed", () => {
  it("bundles workflow + events + projects + clis in one response", async () => {
    const res = await app.inject({ method: "GET", url: "/mock/seed" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body["workflow"]).toBeDefined();
    expect(body["events"]).toBeDefined();
    expect(body["projects"]).toBeDefined();
    expect(body["clis"]).toBeDefined();
  });
});
