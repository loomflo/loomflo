/**
 * Integration tests for GET /projects/:id/events route.
 *
 * Starts a Daemon via startForTest(), registers a project, pre-populates an
 * events.jsonl file in a temp directory, and exercises filtering, pagination,
 * and auth under the /projects/:id/* URL scheme (T11).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { FastifyInstance } from "fastify";
import { Daemon } from "../../src/daemon.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import type { Event } from "../../src/types.js";

// ============================================================================
// Constants
// ============================================================================

const TOKEN = "test-token-events";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const PROJECT_ID = "proj_events01";
const CREDS_PATH = join(homedir(), ".loomflo", "credentials.json");

// ============================================================================
// Test Events
// ============================================================================

const TEST_EVENTS: Event[] = [
  {
    ts: "2026-03-24T10:00:00.000Z",
    type: "node_started",
    workflowId: "wf-1",
    nodeId: "n-1",
    agentId: null,
    details: {},
  },
  {
    ts: "2026-03-24T10:01:00.000Z",
    type: "node_completed",
    workflowId: "wf-1",
    nodeId: "n-1",
    agentId: null,
    details: {},
  },
  {
    ts: "2026-03-24T10:02:00.000Z",
    type: "node_started",
    workflowId: "wf-1",
    nodeId: "n-2",
    agentId: "a-1",
    details: {},
  },
  {
    ts: "2026-03-24T10:03:00.000Z",
    type: "workflow_completed",
    workflowId: "wf-1",
    nodeId: null,
    agentId: null,
    details: {},
  },
  {
    ts: "2026-03-24T10:04:00.000Z",
    type: "workflow_started",
    workflowId: "wf-2",
    nodeId: null,
    agentId: null,
    details: {},
  },
];

// ============================================================================
// Setup / Teardown
// ============================================================================

let tmpDir: string;
let daemon: Daemon;
let server: FastifyInstance;
let credentialsBackup: string | null = null;

const BASE_URL = `/projects/${PROJECT_ID}`;

beforeEach(async () => {
  // Back up any existing credentials.json
  try {
    credentialsBackup = await readFile(CREDS_PATH, "utf-8");
  } catch {
    credentialsBackup = null;
  }

  // Seed a 'default' profile so registerProject can build a provider
  const profiles = new ProviderProfiles(CREDS_PATH);
  await profiles.upsert("default", { type: "anthropic", apiKey: "sk-test-xxx" });

  tmpDir = await mkdtemp(join(tmpdir(), "loomflo-events-routes-"));

  // Pre-populate .loomflo/events.jsonl
  const loomfloDir = join(tmpDir, ".loomflo");
  await mkdir(loomfloDir, { recursive: true });
  const lines = TEST_EVENTS.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(join(loomfloDir, "events.jsonl"), lines, "utf-8");

  daemon = new Daemon({ port: 0, host: "127.0.0.1" });
  await (daemon as unknown as { startForTest: (t: string) => Promise<void> }).startForTest(TOKEN);

  await daemon.registerProject({
    id: PROJECT_ID,
    name: "events-test",
    projectPath: tmpDir,
    providerProfileId: "default",
  });

  server = (daemon as unknown as { server: FastifyInstance }).server;
});

afterEach(async () => {
  await daemon.stop();
  await rm(tmpDir, { recursive: true, force: true });

  // Restore credentials.json
  if (credentialsBackup !== null) {
    await mkdir(join(homedir(), ".loomflo"), { recursive: true });
    await writeFile(CREDS_PATH, credentialsBackup, { mode: 0o600 });
  } else {
    await rm(CREDS_PATH, { force: true });
  }
});

// ============================================================================
// Tests
// ============================================================================

describe("GET /projects/:id/events (integration)", () => {
  it("returns all events with proper auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: `${BASE_URL}/events`,
      headers: AUTH,
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
      url: `${BASE_URL}/events?type=node_started`,
      headers: AUTH,
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
      url: `${BASE_URL}/events?limit=2`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json() as { events: Event[]; total: number };
    expect(body.total).toBe(TEST_EVENTS.length);
    expect(body.events).toHaveLength(2);
  });

  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: `${BASE_URL}/events`,
    });

    expect(res.statusCode).toBe(401);

    const body = res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 for unknown project id", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/projects/proj_unknown/events",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(404);

    const body = res.json() as { error: string };
    expect(body.error).toBe("project_not_registered");
  });
});
