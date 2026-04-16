// packages/cli/tests/unit/start-command.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStart } from "../../src/commands/start.js";

describe("runStart", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-start-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates project.json, ensures daemon, registers project, returns identity", async () => {
    const deps = {
      ensureDaemon: vi.fn(async () => ({ port: 1234, token: "t", pid: 99, version: "0.3.0" })),
      fetchProject: vi.fn(async () => null),
      postProject: vi.fn(async () => ({ id: "proj_xxxxxxxx", status: "idle" })),
    };
    const result = await runStart({ cwd: tmp, providerProfileId: "default", deps });
    expect(deps.ensureDaemon).toHaveBeenCalledTimes(1);
    expect(deps.postProject).toHaveBeenCalledWith(
      expect.objectContaining({ port: 1234, token: "t" }),
      expect.objectContaining({ projectPath: tmp, providerProfileId: "default" }),
    );
    expect(result.identity.id).toMatch(/^proj_[0-9a-f]{8}$/);
    expect(result.daemonInfo.port).toBe(1234);
  });

  it("skips registration if project is already known", async () => {
    const deps = {
      ensureDaemon: vi.fn(async () => ({ port: 1234, token: "t", pid: 99, version: "0.3.0" })),
      fetchProject: vi.fn(async () => ({ id: "proj_aaaaaaaa", status: "running" })),
      postProject: vi.fn(),
    };
    const result = await runStart({ cwd: tmp, providerProfileId: "default", deps });
    expect(deps.postProject).not.toHaveBeenCalled();
    expect(result.daemonInfo.port).toBe(1234);
  });
});
