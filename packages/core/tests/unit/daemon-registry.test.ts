import { describe, it, expect, beforeEach } from "vitest";
import { Daemon } from "../../src/daemon.js";

describe("Daemon registry", () => {
  let daemon: Daemon;

  beforeEach(() => {
    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
  });

  it("starts empty", () => {
    expect(daemon.listProjects()).toEqual([]);
  });

  it("upserts a project and returns it by id", () => {
    const rt = makeFakeRuntime("proj_a");
    daemon.upsertProject(rt);
    expect(daemon.getProject("proj_a")?.id).toBe("proj_a");
  });

  it("lists all projects as summaries", () => {
    daemon.upsertProject(makeFakeRuntime("proj_a"));
    daemon.upsertProject(makeFakeRuntime("proj_b"));
    const list = daemon.listProjects();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id).sort()).toEqual(["proj_a", "proj_b"]);
  });

  it("removes a project by id", () => {
    daemon.upsertProject(makeFakeRuntime("proj_a"));
    daemon.upsertProject(makeFakeRuntime("proj_b"));
    expect(daemon.removeProject("proj_a")).toBe(true);
    expect(daemon.getProject("proj_a")).toBeNull();
    expect(daemon.listProjects()).toHaveLength(1);
  });

  it("returns false when removing an unknown id", () => {
    expect(daemon.removeProject("nope")).toBe(false);
  });

  function makeFakeRuntime(id: string) {
    return {
      id,
      name: id,
      projectPath: `/tmp/${id}`,
      providerProfileId: "default",
      workflow: null,
      provider: {} as never,
      config: {} as never,
      costTracker: {} as never,
      messageBus: {} as never,
      sharedMemory: {} as never,
      startedAt: new Date().toISOString(),
      status: "idle" as const,
    };
  }
});
