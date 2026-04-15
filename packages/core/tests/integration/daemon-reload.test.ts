import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon.js";
import { ProjectsRegistry } from "../../src/persistence/projects.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";

const PROJECTS_JSON = join(homedir(), ".loomflo", "projects.json");
const CREDS_PATH = join(homedir(), ".loomflo", "credentials.json");

describe("daemon reload from projects.json", () => {
  let work: string;
  let registry: ProjectsRegistry;
  let savedRegistry: string | null = null;
  let savedCredentials: string | null = null;

  beforeEach(async () => {
    // Back up any existing projects.json so we don't clobber dev state
    try {
      savedRegistry = await readFile(PROJECTS_JSON, "utf-8");
    } catch {
      savedRegistry = null;
    }

    // Back up any existing credentials.json
    try {
      savedCredentials = await readFile(CREDS_PATH, "utf-8");
    } catch {
      savedCredentials = null;
    }

    await mkdir(join(homedir(), ".loomflo"), { recursive: true });

    // Start from an empty registry so our entry is the only one
    await writeFile(PROJECTS_JSON, "[]");

    // Seed a 'default' provider profile so registerProject can build a provider
    const profiles = new ProviderProfiles(CREDS_PATH);
    await profiles.upsert("default", { type: "anthropic", apiKey: "sk-test-reload" });

    work = await mkdtemp(join(tmpdir(), "loomflo-reload-"));
    registry = new ProjectsRegistry(PROJECTS_JSON);
    await registry.upsert({
      id: "proj_persist1",
      name: "persisted",
      projectPath: work,
      providerProfileId: "default",
    });
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });

    // Restore the user's original registry (or empty)
    if (savedRegistry !== null) {
      await writeFile(PROJECTS_JSON, savedRegistry);
    } else {
      await rm(PROJECTS_JSON, { force: true });
    }

    // Restore the user's original credentials (or empty)
    if (savedCredentials !== null) {
      await mkdir(join(homedir(), ".loomflo"), { recursive: true });
      await writeFile(CREDS_PATH, savedCredentials, { mode: 0o600 });
    } else {
      await rm(CREDS_PATH, { force: true });
    }
  });

  it("loads projects from projects.json on daemon start", async () => {
    const daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as any).startForTest("tok");
    try {
      const list = daemon.listProjects();
      expect(list.some((p) => p.id === "proj_persist1")).toBe(true);
    } finally {
      await daemon.stop();
    }
  });
});
