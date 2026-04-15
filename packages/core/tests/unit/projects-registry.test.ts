import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectsRegistry, type ProjectEntry } from "../../src/persistence/projects.js";

describe("ProjectsRegistry", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-projects-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns empty list when file is absent", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    expect(await reg.list()).toEqual([]);
  });

  it("round-trips entries via upsert + list", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    const entry: ProjectEntry = {
      id: "proj_a1",
      name: "app",
      projectPath: "/tmp/app",
      providerProfileId: "default",
    };
    await reg.upsert(entry);
    expect(await reg.list()).toEqual([entry]);
  });

  it("overwrites an existing entry with the same id", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    await reg.upsert({
      id: "proj_a1",
      name: "v1",
      projectPath: "/a",
      providerProfileId: "default",
    });
    await reg.upsert({
      id: "proj_a1",
      name: "v2",
      projectPath: "/a",
      providerProfileId: "default",
    });
    const list = await reg.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("v2");
  });

  it("removes an entry by id", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    await reg.upsert({ id: "proj_a1", name: "a", projectPath: "/a", providerProfileId: "default" });
    await reg.upsert({ id: "proj_b2", name: "b", projectPath: "/b", providerProfileId: "default" });
    await reg.remove("proj_a1");
    const list = await reg.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("proj_b2");
  });

  it("recovers from a corrupt file by renaming it and starting empty", async () => {
    const path = join(tmp, "projects.json");
    await writeFile(path, "{not json");
    const reg = new ProjectsRegistry(path);
    expect(await reg.list()).toEqual([]);
    const raw = await readFile(path, "utf-8").catch(() => null);
    // new empty array persisted
    expect(raw).toBe("[]");
  });

  it("writes 0600 permissions", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    await reg.upsert({
      id: "proj_a1",
      name: "app",
      projectPath: "/a",
      providerProfileId: "default",
    });
    const { stat } = await import("node:fs/promises");
    const s = await stat(join(tmp, "projects.json"));
    // 0o600 = owner read/write only
    expect(s.mode & 0o777).toBe(0o600);
  });
});
