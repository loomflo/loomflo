import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";

const TOKEN = "test-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };

const CREDS_PATH = join(homedir(), ".loomflo", "credentials.json");

describe("/projects CRUD", () => {
  let daemon: Daemon;
  let workspace: string;
  let credentialsBackup: string | null = null;

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

    workspace = await mkdtemp(join(tmpdir(), "loomflo-api-"));
    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as unknown as { startForTest: (t: string) => Promise<void> }).startForTest(TOKEN);
  });

  afterEach(async () => {
    await daemon.stop();
    await rm(workspace, { recursive: true, force: true });

    // Restore credentials.json
    if (credentialsBackup !== null) {
      await mkdir(join(homedir(), ".loomflo"), { recursive: true });
      await writeFile(CREDS_PATH, credentialsBackup, { mode: 0o600 });
    } else {
      // Remove the file we created (best-effort)
      await rm(CREDS_PATH, { force: true });
    }
  });

  it("GET /projects returns [] when empty", async () => {
    const res = await (daemon as any).server.inject({
      method: "GET",
      url: "/projects",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("POST /projects registers a project and returns its summary", async () => {
    const res = await (daemon as any).server.inject({
      method: "POST",
      url: "/projects",
      headers: AUTH,
      payload: {
        id: "proj_abcdef01",
        name: "my-app",
        projectPath: workspace,
        providerProfileId: "default",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.id).toBe("proj_abcdef01");
    expect(body.status).toBe("idle");
  });

  it("POST /projects returns 409 when id already registered", async () => {
    const payload = {
      id: "proj_abcdef01",
      name: "my-app",
      projectPath: workspace,
      providerProfileId: "default",
    };
    await (daemon as any).server.inject({ method: "POST", url: "/projects", headers: AUTH, payload });
    const dup = await (daemon as any).server.inject({
      method: "POST",
      url: "/projects",
      headers: AUTH,
      payload,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "project_already_registered" });
  });

  it("GET /projects/:id returns 404 for unknown", async () => {
    const res = await (daemon as any).server.inject({
      method: "GET",
      url: "/projects/proj_00000000",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "project_not_registered" });
  });

  it("DELETE /projects/:id deregisters", async () => {
    await (daemon as any).server.inject({
      method: "POST",
      url: "/projects",
      headers: AUTH,
      payload: {
        id: "proj_abcdef01",
        name: "my-app",
        projectPath: workspace,
        providerProfileId: "default",
      },
    });
    const del = await (daemon as any).server.inject({
      method: "DELETE",
      url: "/projects/proj_abcdef01",
      headers: AUTH,
    });
    expect(del.statusCode).toBe(204);

    const after = await (daemon as any).server.inject({
      method: "GET",
      url: "/projects/proj_abcdef01",
      headers: AUTH,
    });
    expect(after.statusCode).toBe(404);
  });

  it("requires Bearer auth on all routes", async () => {
    const res = await (daemon as any).server.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(401);
  });
});
