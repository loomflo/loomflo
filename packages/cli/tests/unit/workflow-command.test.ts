import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue({ port: 42000, token: "t", pid: 9, version: "0.3.0" }),
  getRunningDaemon: vi.fn(),
}));

let tmp: string;
let stdoutWrites: string[];
let stderrWrites: string[];

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "loomflo-workflow-cmd-"));
  await mkdir(join(tmp, ".loomflo"), { recursive: true });
  // Seed project.json so resolveProject(..., createIfMissing: false) succeeds.
  await writeFile(
    join(tmp, ".loomflo", "project.json"),
    JSON.stringify({
      id: "proj_abc",
      name: "sandbox",
      providerProfileId: "default",
      createdAt: new Date().toISOString(),
    }),
  );
  process.chdir(tmp);
  stdoutWrites = [];
  stderrWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((c) => {
    stderrWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loomflo workflow init", () => {
  it("seeds a workflow and prints a ready line with node count", async () => {
    const deps = {
      postInit: vi.fn().mockResolvedValue({ id: "wf_42", status: "spec", description: "x" }),
      getWorkflow: vi.fn().mockResolvedValue({
        id: "wf_42",
        status: "building",
        description: "x",
        graph: { nodes: { a: {}, b: {}, c: {} }, edges: [], topology: "linear" },
      }),
      sleep: (): Promise<void> => Promise.resolve(),
      pollIntervalMs: 10,
      timeoutMs: 10_000,
      now: (): number => 0,
    };
    const { createWorkflowCommand } = await import("../../src/commands/workflow.js");
    await createWorkflowCommand(deps).parseAsync([
      "node",
      "workflow",
      "init",
      "my description",
    ]);
    const out = stdoutWrites.join("");
    expect(out).toContain("workflow");
    expect(out).toContain("3 nodes");
    expect(deps.postInit).toHaveBeenCalledWith(
      expect.objectContaining({ port: 42000 }),
      "proj_abc",
      { description: "my description", projectPath: tmp },
    );
    expect(process.exitCode).not.toBe(1);
  });

  it("surfaces E_WORKFLOW_CONFLICT on 409 and exits 1", async () => {
    const conflict = Object.assign(new Error("A workflow is already active"), { status: 409 });
    const deps = {
      postInit: vi.fn().mockRejectedValue(conflict),
      getWorkflow: vi.fn(),
      sleep: (): Promise<void> => Promise.resolve(),
      pollIntervalMs: 10,
      timeoutMs: 10_000,
      now: (): number => 0,
    };
    const { createWorkflowCommand } = await import("../../src/commands/workflow.js");
    await createWorkflowCommand(deps).parseAsync(["node", "workflow", "init", "x"]);
    expect(process.exitCode).toBe(1);
    const err = stderrWrites.join("");
    expect(err).toContain("E_WORKFLOW_CONFLICT");
  });

  it("emits JSON payload under --json", async () => {
    const deps = {
      postInit: vi.fn().mockResolvedValue({ id: "wf_9", status: "spec", description: "x" }),
      getWorkflow: vi.fn().mockResolvedValue({
        id: "wf_9",
        status: "building",
        description: "x",
        graph: { nodes: { n1: {} }, edges: [], topology: "linear" },
      }),
      sleep: (): Promise<void> => Promise.resolve(),
      pollIntervalMs: 10,
      timeoutMs: 10_000,
      now: (): number => 0,
    };
    const { createWorkflowCommand } = await import("../../src/commands/workflow.js");
    await createWorkflowCommand(deps).parseAsync([
      "node",
      "workflow",
      "init",
      "x",
      "--json",
    ]);
    const parsed = JSON.parse(stdoutWrites.join("").trim()) as {
      workflow: { id: string; nodeCount: number; status: string };
    };
    expect(parsed.workflow).toEqual({ id: "wf_9", status: "building", nodeCount: 1 });
  });
});
