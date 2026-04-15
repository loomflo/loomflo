// packages/cli/tests/unit/init-command.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";

describe("runInit", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-init-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates identity, registers project, calls /workflow/init", async () => {
    const deps = {
      ensureDaemon: vi.fn(async () => ({ port: 1234, token: "t", pid: 9, version: "0.2.0" })),
      fetchProject: vi.fn(async () => null),
      postProject: vi.fn(async () => ({ id: "proj_xxxxxxxx", status: "idle" })),
      initWorkflow: vi.fn(async () => ({ id: "wf_1", status: "generating" })),
    };
    await runInit({ cwd: tmp, description: "build something", providerProfileId: "default", deps });
    expect(deps.postProject).toHaveBeenCalled();
    expect(deps.initWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^proj_[0-9a-f]{8}$/),
      { description: "build something", projectPath: tmp },
    );
  });

  it("skips registration if project is already registered", async () => {
    const deps = {
      ensureDaemon: vi.fn(async () => ({ port: 1234, token: "t", pid: 9, version: "0.2.0" })),
      fetchProject: vi.fn(async () => ({ id: "proj_aaaaaaaa", status: "idle" })),
      postProject: vi.fn(),
      initWorkflow: vi.fn(async () => ({ id: "wf_2", status: "generating" })),
    };
    const result = await runInit({
      cwd: tmp,
      description: "build something",
      providerProfileId: "default",
      deps,
    });
    expect(deps.postProject).not.toHaveBeenCalled();
    expect(deps.initWorkflow).toHaveBeenCalled();
    expect(result.workflow.id).toBe("wf_2");
  });
});
