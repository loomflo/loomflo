/**
 * Integration tests for GET /events route.
 *
 * Starts a Fastify server via createServer(), pre-populates an events.jsonl
 * file in a temp directory, and exercises filtering, pagination, and auth.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/api/server.js";
import type { Event } from "../../src/types.js";

// ============================================================================
// Constants
// ============================================================================

const TOKEN = "test-token-events";

// ============================================================================
// Test Events
// ============================================================================

const TEST_EVENTS: Event[] = [
  { ts: "2026-03-24T10:00:00.000Z", type: "node_started",        workflowId: "wf-1", nodeId: "n-1", agentId: null,  details: {} },
  { ts: "2026-03-24T10:01:00.000Z", type: "node_completed",      workflowId: "wf-1", nodeId: "n-1", agentId: null,  details: {} },
  { ts: "2026-03-24T10:02:00.000Z", type: "node_started",        workflowId: "wf-1", nodeId: "n-2", agentId: "a-1", details: {} },
  { ts: "2026-03-24T10:03:00.000Z", type: "workflow_completed",   workflowId: "wf-1", nodeId: null,  agentId: null,  details: {} },
  { ts: "2026-03-24T10:04:00.000Z", type: "workflow_started",     workflowId: "wf-2", nodeId: null,  agentId: null,  details: {} },
];

// ============================================================================
// Setup / Teardown
// ============================================================================

let tmpDir: string;
let server: FastifyInstance;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "loomflo-events-routes-"));

  // Pre-populate .loomflo/events.jsonl
  const loomfloDir = join(tmpDir, ".loomflo");
  await mkdir(loomfloDir, { recursive: true });
  const lines = TEST_EVENTS.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(join(loomfloDir, "events.jsonl"), lines, "utf-8");

  const result = await createServer({
    token: TOKEN,
    projectPath: tmpDir,
    dashboardPath: null,
    events: { getProjectPath: () => tmpDir },
  });
  server = result.server;
});

afterEach(async () => {
  await server.close();
  await rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Tests
// ============================================================================

describe("GET /events (integration)", () => {
  it("returns all events with proper auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/events",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json() as { events: Event[]; total: number };
    expect(body.total).toBe(TEST_EVENTS.length);
    expect(body.events).toHaveLength(TEST_EVENTS.length);
    expect(body.events[0]!.type).toBe("node_started");
  });

  it("filters by type via ?type=node_started", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/events?type=node_started",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json() as { events: Event[]; total: number };
    expect(body.total).toBe(2);
    expect(body.events).toHaveLength(2);
    expect(body.events.every((e) => e.type === "node_started")).toBe(true);
  });

  it("paginates via ?limit=2", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/events?limit=2",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json() as { events: Event[]; total: number };
    expect(body.total).toBe(TEST_EVENTS.length);
    expect(body.events).toHaveLength(2);
  });

  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/events",
    });

    expect(res.statusCode).toBe(401);

    const body = res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });
});
