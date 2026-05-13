/**
 * End-to-end integration tests for the multi-project daemon workflow.
 *
 * Uses Daemon.startForTest() + registerProject() and exercises routes
 * under /projects/:id/* (T11).
 *
 * The spec-generation background task runs against the registered project's
 * provider. To keep tests hermetic and fast the provider is expected to fail
 * (no real API key), so only the synchronous response parts are verified in
 * tests that don't need spec generation to complete.
 *
 * Tests that require a full spec-generation cycle use a mock Anthropic
 * server stub (nock-style) via vitest's module mocking, or they directly
 * manipulate rt.workflow to simulate a completed spec.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import { Daemon } from "../../src/daemon.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import type { FastifyInstance } from "fastify";
import type { Workflow } from "../../src/types.js";
import type { ProjectRuntime } from "../../src/daemon-types.js";

// ============================================================================
// Constants
// ============================================================================

const AUTH_TOKEN = "e2e-test-token-9876";
const AUTH = { authorization: `Bearer ${AUTH_TOKEN}` };
const PROJECT_ID = "proj_e2e00001";
const CREDS_PATH = join(homedir(), ".loomflo", "credentials.json");
const PROJECTS_JSON = join(homedir(), ".loomflo", "projects.json");

// ============================================================================
// Test Suite
// ============================================================================

describe("End-to-end: init → spec → start → nodes (integration)", () => {
  let projectPath: string;
  let daemon: Daemon;
  let server: FastifyInstance;
  let credentialsBackup: string | null = null;
  let registryBackup: string | null = null;

  const BASE_URL = `/projects/${PROJECT_ID}`;

  beforeEach(async () => {
    // Back up any existing credentials.json
    try {
      credentialsBackup = await readFile(CREDS_PATH, "utf-8");
    } catch {
      credentialsBackup = null;
    }

    // Back up any existing projects.json and start from an empty registry
    try {
      registryBackup = await readFile(PROJECTS_JSON, "utf-8");
    } catch {
      registryBackup = null;
    }
    await mkdir(join(homedir(), ".loomflo"), { recursive: true });
    await writeFile(PROJECTS_JSON, "[]");

    // Seed a 'default' profile so registerProject can build a provider
    const profiles = new ProviderProfiles(CREDS_PATH);
    await profiles.upsert("default", { type: "anthropic", apiKey: "sk-test-xxx" });

    projectPath = join(
      tmpdir(),
      `loomflo-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(projectPath, { recursive: true });

    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as unknown as { startForTest: (t: string) => Promise<void> }).startForTest(
      AUTH_TOKEN,
    );

    await daemon.registerProject({
      id: PROJECT_ID,
      name: "e2e-test",
      projectPath,
      providerProfileId: "default",
    });

    server = (daemon as unknown as { server: FastifyInstance }).server;
  });

  afterEach(async () => {
    await daemon.stop();
    /* Brief wait for background spec generation to settle. */
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 200);
    });
    await rm(projectPath, { recursive: true, force: true }).catch((): void => {
      /* Best-effort cleanup. */
    });

    // Restore credentials.json
    if (credentialsBackup !== null) {
      await mkdir(join(homedir(), ".loomflo"), { recursive: true });
      await writeFile(CREDS_PATH, credentialsBackup, { mode: 0o600 });
    } else {
      await rm(CREDS_PATH, { force: true });
    }

    // Restore projects.json
    if (registryBackup !== null) {
      await writeFile(PROJECTS_JSON, registryBackup);
    } else {
      await rm(PROJECTS_JSON, { force: true });
    }
  });

  // --------------------------------------------------------------------------
  // Full workflow flow (using direct runtime manipulation for speed/reliability)
  // --------------------------------------------------------------------------

  it("should complete the full init → spec → start flow (direct rt manipulation)", async () => {
    const rt = daemon.getProject(PROJECT_ID) as ProjectRuntime;

    /* Directly set a building-state workflow (skipping spec generation
     * background task which would fail with the test API key). */
    const now = new Date().toISOString();
    rt.workflow = {
      id: "wf-e2e-full-flow-test",
      status: "building",
      description: "Build a REST API with auth and PostgreSQL",
      projectPath,
      graph: {
        nodes: {
          "node-setup": {
            id: "node-setup",
            title: "Project Setup",
            status: "pending",
            instructions: "Set up the project",
            delay: "0",
            resumeAt: null,
            agents: [],
            fileOwnership: {},
            retryCount: 0,
            maxRetries: 3,
            reviewReport: null,
            cost: 0,
            startedAt: null,
            completedAt: null,
            providerRetryState: null,
          },
          "node-impl": {
            id: "node-impl",
            title: "Core Implementation",
            status: "pending",
            instructions: "Implement the feature",
            delay: "0",
            resumeAt: null,
            agents: [],
            fileOwnership: {},
            retryCount: 0,
            maxRetries: 3,
            reviewReport: null,
            cost: 0,
            startedAt: null,
            completedAt: null,
            providerRetryState: null,
          },
          "node-test": {
            id: "node-test",
            title: "Testing",
            status: "pending",
            instructions: "Write tests",
            delay: "0",
            resumeAt: null,
            agents: [],
            fileOwnership: {},
            retryCount: 0,
            maxRetries: 3,
            reviewReport: null,
            cost: 0,
            startedAt: null,
            completedAt: null,
            providerRetryState: null,
          },
        },
        edges: [
          { from: "node-setup", to: "node-impl" },
          { from: "node-impl", to: "node-test" },
        ],
        topology: "linear",
      },
      config: rt.config,
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
    } satisfies Workflow;

    /* ---- Step 3: GET /projects/:id/workflow confirms building state ---- */
    const getRes = await server.inject({
      method: "GET",
      url: `${BASE_URL}/workflow`,
      headers: AUTH,
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body) as {
      status: string;
      graph: { nodes: Record<string, unknown> };
    };
    expect(getBody.status).toBe("building");
    expect(Object.keys(getBody.graph.nodes).length).toBe(3);

    /* ---- Step 4: POST /projects/:id/workflow/start transitions to running */
    const startRes = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/start`,
      headers: AUTH,
    });

    expect(startRes.statusCode).toBe(200);
    const startBody = JSON.parse(startRes.body) as { status: string };
    expect(startBody.status).toBe("running");

    /* ---- Step 5: GET /projects/:id/workflow confirms running state ------ */
    const runningRes = await server.inject({
      method: "GET",
      url: `${BASE_URL}/workflow`,
      headers: AUTH,
    });

    expect(runningRes.statusCode).toBe(200);
    const runningBody = JSON.parse(runningRes.body) as { status: string };
    expect(runningBody.status).toBe("running");

    /* ---- Step 6: GET /projects/:id/nodes returns all 3 nodes ----------- */
    const nodesRes = await server.inject({
      method: "GET",
      url: `${BASE_URL}/nodes`,
      headers: AUTH,
    });

    expect(nodesRes.statusCode).toBe(200);
    const nodesBody = JSON.parse(nodesRes.body) as Array<{
      id: string;
      title: string;
      status: string;
    }>;
    expect(nodesBody.length).toBe(3);

    const titles = nodesBody.map((n) => n.title);
    expect(titles).toContain("Project Setup");
    expect(titles).toContain("Core Implementation");
    expect(titles).toContain("Testing");
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  it("should reject a second init while the first is in progress", async () => {
    await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: { description: "First project", projectPath },
    });

    const secondRes = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: { description: "Second project", projectPath },
    });

    expect(secondRes.statusCode).toBe(409);
  });

  it("should show health endpoint without authentication", async () => {
    const healthRes = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(healthRes.statusCode).toBe(200);
    const body = JSON.parse(healthRes.body) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("should reject workflow operations without auth token", async () => {
    const res = await server.inject({
      method: "GET",
      url: `${BASE_URL}/workflow`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("should return 404 for nodes when no workflow exists", async () => {
    const nodesRes = await server.inject({
      method: "GET",
      url: `${BASE_URL}/nodes`,
      headers: AUTH,
    });

    expect(nodesRes.statusCode).toBe(404);
  });

  it("should return individual node detail after simulated spec generation", async () => {
    const rt = daemon.getProject(PROJECT_ID) as ProjectRuntime;
    const now = new Date().toISOString();

    /* Directly set a building-state workflow with nodes */
    rt.workflow = {
      id: "wf-node-detail-test",
      status: "building",
      description: "Build a todo app",
      projectPath,
      graph: {
        nodes: {
          "node-setup": {
            id: "node-setup",
            title: "Project Setup",
            status: "pending",
            instructions: "1. Initialize the project\n2. Create directory structure",
            delay: "0",
            resumeAt: null,
            agents: [],
            fileOwnership: {},
            retryCount: 0,
            maxRetries: 3,
            reviewReport: null,
            cost: 0,
            startedAt: null,
            completedAt: null,
            providerRetryState: null,
          },
        },
        edges: [],
        topology: "linear",
      },
      config: rt.config,
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
    } satisfies Workflow;

    /* Start the workflow */
    await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/start`,
      headers: AUTH,
    });

    /* Fetch individual node detail */
    const nodeRes = await server.inject({
      method: "GET",
      url: `${BASE_URL}/nodes/node-setup`,
      headers: AUTH,
    });

    expect(nodeRes.statusCode).toBe(200);
    const nodeBody = JSON.parse(nodeRes.body) as {
      id: string;
      title: string;
      instructions: string;
    };
    expect(nodeBody.id).toBe("node-setup");
    expect(nodeBody.title).toBe("Project Setup");
    expect(nodeBody.instructions).toBeDefined();
  });

  it("should return 404 for a non-existent node", async () => {
    const rt = daemon.getProject(PROJECT_ID) as ProjectRuntime;
    const now = new Date().toISOString();

    /* Set a building-state workflow */
    rt.workflow = {
      id: "wf-404-node-test",
      status: "building",
      description: "Test",
      projectPath,
      graph: { nodes: {}, edges: [], topology: "linear" },
      config: rt.config,
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
    } satisfies Workflow;

    const nodeRes = await server.inject({
      method: "GET",
      url: `${BASE_URL}/nodes/nonexistent-node`,
      headers: AUTH,
    });

    expect(nodeRes.statusCode).toBe(404);
  });

  it("should return 404 for unknown project id", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/projects/proj_unknown/workflow",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toBe("project_not_registered");
  });
});
