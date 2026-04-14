import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readProjectIdentity,
  createProjectIdentity,
  ensureProjectIdentity,
  generateProjectId,
} from "../../src/persistence/project-identity.js";

describe("project-identity", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-ident-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("generateProjectId returns 'proj_<8 hex>'", () => {
    const id = generateProjectId();
    expect(id).toMatch(/^proj_[0-9a-f]{8}$/);
  });

  it("createProjectIdentity writes .loomflo/project.json with the expected shape", async () => {
    const ident = await createProjectIdentity(tmp, { name: "my-app" });
    expect(ident.id).toMatch(/^proj_[0-9a-f]{8}$/);
    expect(ident.name).toBe("my-app");
    expect(ident.providerProfileId).toBe("default");
    expect(ident.createdAt).toBeDefined();

    const raw = await readFile(join(tmp, ".loomflo", "project.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(ident);
  });

  it("createProjectIdentity defaults name to directory basename", async () => {
    const ident = await createProjectIdentity(tmp);
    expect(ident.name).toBe(tmp.split("/").pop());
  });

  it("readProjectIdentity finds the file by walking up", async () => {
    const ident = await createProjectIdentity(tmp, { name: "walkup" });
    const nested = join(tmp, "src", "deep", "nested");
    await mkdir(nested, { recursive: true });
    const found = await readProjectIdentity(nested);
    expect(found).toEqual(ident);
  });

  it("readProjectIdentity returns null when no project.json exists up-tree", async () => {
    const found = await readProjectIdentity(tmp);
    expect(found).toBeNull();
  });

  it("ensureProjectIdentity creates when absent and returns existing when present", async () => {
    const first = await ensureProjectIdentity(tmp, { name: "ensure" });
    const second = await ensureProjectIdentity(tmp);
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("ensure");
  });

  it("ensureProjectIdentity migrates a legacy layout (state.json without project.json)", async () => {
    await mkdir(join(tmp, ".loomflo"), { recursive: true });
    await writeFile(
      join(tmp, ".loomflo", "state.json"),
      JSON.stringify({ id: "wf_old", status: "running" }),
    );
    const ident = await ensureProjectIdentity(tmp);
    expect(ident.id).toMatch(/^proj_[0-9a-f]{8}$/);
    expect(ident.name).toBe(tmp.split("/").pop());
    const raw = await readFile(join(tmp, ".loomflo", "project.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(ident);
  });
});
