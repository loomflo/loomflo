/**
 * Integration tests for /projects/:id/workflow/init and related routes.
 *
 * Starts a Daemon via startForTest(), registers a project, and exercises
 * workflow init/get/start/start-rejection under the /projects/:id/* URL
 * scheme (T11).
 *
 * Because the spec-generation background task runs against the registered
 * project's provider, these tests use a real registered project. To keep
 * tests fast and hermetic, provider calls are expected to fail (no real API
 * key), so only the synchronous parts (request/response) are verified.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import { Daemon } from "../../src/daemon.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import type { FastifyInstance } from "fastify";
import type { Workflow } from "../../src/types.js";

// ============================================================================
// Constants
// ============================================================================

const AUTH_TOKEN = "test-token-12345";
const AUTH = { authorization: `Bearer ${AUTH_TOKEN}` };
const PROJECT_ID = "proj_wfinit01";
const CREDS_PATH = join(homedir(), ".loomflo", "credentials.json");
const PROJECTS_JSON = join(homedir(), ".loomflo", "projects.json");

// ============================================================================
// Test Suite
// ============================================================================

describe("POST /projects/:id/workflow/init (integration)", () => {
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
      `loomflo-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(projectPath, { recursive: true });

    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as unknown as { startForTest: (t: string) => Promise<void> }).startForTest(
      AUTH_TOKEN,
    );

    await daemon.registerProject({
      id: PROJECT_ID,
      name: "workflow-init-test",
      projectPath,
      providerProfileId: "default",
    });

    server = (daemon as unknown as { server: FastifyInstance }).server;
  });

  afterEach(async () => {
    await daemon.stop();
    /* Wait briefly for any background spec generation to settle before cleanup. */
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 100);
    });
    await rm(projectPath, { recursive: true, force: true }).catch((): void => {
      /* Best-effort cleanup — ignore errors from background operations. */
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
  // POST /projects/:id/workflow/init
  // --------------------------------------------------------------------------

  it("should create a workflow and return 201", async () => {
    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: {
        description: "Build a todo app",
        projectPath,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { id: string; status: string; description: string };
    expect(body.id).toBeDefined();
    expect(body.status).toBe("spec");
    expect(body.description).toBe("Build a todo app");
  });

  it("should reject a second workflow init (409 conflict)", async () => {
    /* First init */
    await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: { description: "First project", projectPath },
    });

    /* Second init should fail */
    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: { description: "Second project", projectPath },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain("already active");
  });

  it("should reject missing description (400)", async () => {
    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: { projectPath },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should reject missing projectPath (400)", async () => {
    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: { description: "Build something" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should reject unauthenticated requests (401)", async () => {
    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      payload: { description: "Test", projectPath },
    });

    expect(response.statusCode).toBe(401);
  });

  it("should reject wrong token (401)", async () => {
    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: { authorization: "Bearer wrong-token" },
      payload: { description: "Test", projectPath },
    });

    expect(response.statusCode).toBe(401);
  });

  // --------------------------------------------------------------------------
  // GET /projects/:id/workflow
  // --------------------------------------------------------------------------

  it("should return 404 when no workflow exists", async () => {
    const response = await server.inject({
      method: "GET",
      url: `${BASE_URL}/workflow`,
      headers: AUTH,
    });

    expect(response.statusCode).toBe(404);
  });

  it("should return the workflow after init", async () => {
    /* Create a workflow */
    await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: { description: "Build a todo app", projectPath },
    });

    /* Retrieve it */
    const response = await server.inject({
      method: "GET",
      url: `${BASE_URL}/workflow`,
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      id: string;
      status: string;
      description: string;
      projectPath: string;
      graph: unknown;
    };
    expect(body.description).toBe("Build a todo app");
    expect(body.projectPath).toBe(projectPath);
    expect(body.graph).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // POST /projects/:id/workflow/start
  // --------------------------------------------------------------------------

  it("should reject start when no workflow exists (404)", async () => {
    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/start`,
      headers: AUTH,
    });

    expect(response.statusCode).toBe(404);
  });

  it("should reject start when workflow is in spec status (400)", async () => {
    /* Create a workflow (starts in 'spec' status) */
    await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/init`,
      headers: AUTH,
      payload: { description: "Build a todo app", projectPath },
    });

    /* Try to start immediately — workflow is in 'spec', not 'building' */
    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/start`,
      headers: AUTH,
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain("building");
  });

  it("should start a workflow that is in building status", async () => {
    /* Directly set the runtime's workflow to 'building' status to simulate
     * spec generation completion without triggering the background process. */
    const rt = daemon.getProject(PROJECT_ID);
    expect(rt).not.toBeNull();

    const now = new Date().toISOString();
    rt!.workflow = {
      id: "test-workflow-id",
      status: "building",
      description: "Build a todo app",
      projectPath,
      graph: { nodes: {}, edges: [], topology: "linear" },
      config: rt!.config,
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
    } satisfies Workflow;

    const response = await server.inject({
      method: "POST",
      url: `${BASE_URL}/workflow/start`,
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe("running");
    expect(rt!.workflow?.status).toBe("running");
  });

  // --------------------------------------------------------------------------
  // GET /health (no auth required)
  // --------------------------------------------------------------------------

  it("should return health without auth", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe("ok");
  });

  // --------------------------------------------------------------------------
  // Unknown project returns 404
  // --------------------------------------------------------------------------

  it("should return 404 for unknown project id", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/projects/proj_unknown/workflow",
      headers: AUTH,
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe("project_not_registered");
  });
});
