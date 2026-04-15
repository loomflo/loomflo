import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";

const CREDENTIALS = join(homedir(), ".loomflo", "credentials.json");
const PROJECTS_JSON = join(homedir(), ".loomflo", "projects.json");

describe("multi-project parallel", () => {
  let daemon: Daemon;
  let workA: string;
  let workB: string;
  let savedCredentials: string | null = null;
  let savedProjects: string | null = null;

  beforeEach(async () => {
    // Back up any existing files so we don't clobber dev state
    try { savedCredentials = await readFile(CREDENTIALS, "utf-8"); } catch { savedCredentials = null; }
    try { savedProjects = await readFile(PROJECTS_JSON, "utf-8"); } catch { savedProjects = null; }
    await mkdir(join(homedir(), ".loomflo"), { recursive: true });
    // Start from empty registry
    await writeFile(PROJECTS_JSON, "[]");
    // Seed the default provider profile
    const profiles = new ProviderProfiles(CREDENTIALS);
    await profiles.upsert("default", { type: "anthropic", apiKey: "sk-test-multi" });

    workA = await mkdtemp(join(tmpdir(), "loomflo-A-"));
    workB = await mkdtemp(join(tmpdir(), "loomflo-B-"));
    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as any).startForTest("tok");
  });

  afterEach(async () => {
    await daemon.stop();
    await rm(workA, { recursive: true, force: true });
    await rm(workB, { recursive: true, force: true });
    // Restore original files
    if (savedCredentials !== null) await writeFile(CREDENTIALS, savedCredentials);
    else await rm(CREDENTIALS, { force: true });
    if (savedProjects !== null) await writeFile(PROJECTS_JSON, savedProjects);
    else await rm(PROJECTS_JSON, { force: true });
  });

  it("registers two projects independently", async () => {
    const register = async (id: string, projectPath: string) =>
      await (daemon as any).server.inject({
        method: "POST",
        url: "/projects",
        headers: { authorization: "Bearer tok" },
        payload: { id, name: id, projectPath, providerProfileId: "default" },
      });

    const a = await register("proj_aaaaaaaa", workA);
    const b = await register("proj_bbbbbbbb", workB);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);

    const list = await (daemon as any).server.inject({
      method: "GET",
      url: "/projects",
      headers: { authorization: "Bearer tok" },
    });
    const summaries = list.json() as Array<{ id: string }>;
    expect(summaries.map((s) => s.id).sort()).toEqual(["proj_aaaaaaaa", "proj_bbbbbbbb"]);
  });

  it("isolates workflow state between projects", async () => {
    const register = async (id: string, projectPath: string) =>
      await (daemon as any).server.inject({
        method: "POST",
        url: "/projects",
        headers: { authorization: "Bearer tok" },
        payload: { id, name: id, projectPath, providerProfileId: "default" },
      });
    await register("proj_aaaaaaaa", workA);
    await register("proj_bbbbbbbb", workB);

    // Mutate runtime A's workflow directly via the registry.
    const rtA = daemon.getProject("proj_aaaaaaaa")!;
    rtA.workflow = {
      id: "wf_a",
      status: "running",
      projectPath: workA,
      graph: { nodes: {}, edges: [] },
    } as never;

    const rtB = daemon.getProject("proj_bbbbbbbb")!;
    expect(rtB.workflow).toBeNull();
  });
});
