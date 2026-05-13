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

  it("--timeout overrides the default poll deadline", async () => {
    // Make the deps never advance out of "spec" so the wall must kick
    // in. A caller-supplied --timeout of 1 second is passed through and
    // trips E_WORKFLOW_TIMEOUT quickly under the fake clock.
    let t = 0;
    const deps = {
      postInit: vi.fn().mockResolvedValue({ id: "wf_t", status: "spec", description: "x" }),
      getWorkflow: vi.fn().mockResolvedValue({
        id: "wf_t",
        status: "spec",
        description: "x",
        graph: { nodes: {}, edges: [], topology: "linear" },
      }),
      sleep: (ms: number): Promise<void> => {
        t += ms;
        return Promise.resolve();
      },
      pollIntervalMs: 100,
      now: (): number => t,
    };
    const { createWorkflowCommand } = await import("../../src/commands/workflow.js");
    await createWorkflowCommand(deps).parseAsync([
      "node",
      "workflow",
      "init",
      "x",
      "--timeout",
      "1",
    ]);
    expect(process.exitCode).toBe(1);
    const err = stderrWrites.join("");
    expect(err).toContain("E_WORKFLOW_TIMEOUT");
  });

  it("rejects non-numeric --timeout", async () => {
    const deps = {
      postInit: vi.fn(),
      getWorkflow: vi.fn(),
      sleep: (): Promise<void> => Promise.resolve(),
      pollIntervalMs: 10,
      now: (): number => 0,
    };
    const { createWorkflowCommand } = await import("../../src/commands/workflow.js");
    await createWorkflowCommand(deps).parseAsync([
      "node",
      "workflow",
      "init",
      "x",
      "--timeout",
      "abc",
    ]);
    expect(process.exitCode).toBe(1);
    const err = stderrWrites.join("");
    expect(err).toContain("E_WORKFLOW_FLAG");
    expect(deps.postInit).not.toHaveBeenCalled();
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

  it("--no-wait returns after the kickoff without polling", async () => {
    const deps = {
      postInit: vi.fn().mockResolvedValue({ id: "wf_nw", status: "spec", description: "x" }),
      getWorkflow: vi.fn(),
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
      "--no-wait",
    ]);
    expect(deps.postInit).toHaveBeenCalledTimes(1);
    expect(deps.getWorkflow).not.toHaveBeenCalled();
    const out = stdoutWrites.join("");
    expect(out).toContain("queued");
    expect(out).toContain("loomflo workflow watch");
    expect(process.exitCode).not.toBe(1);
  });
});

describe("loomflo workflow watch", () => {
  it("polls until the workflow exits spec state and reports the node count", async () => {
    const states = [
      {
        id: "wf_w",
        status: "spec",
        description: "x",
        graph: { nodes: {}, edges: [], topology: "linear" },
      },
      {
        id: "wf_w",
        status: "building",
        description: "x",
        graph: { nodes: { a: {}, b: {} }, edges: [], topology: "linear" },
      },
    ];
    const getWorkflow = vi
      .fn()
      .mockImplementation(async () => states.shift() ?? states[states.length - 1]);
    const deps = {
      postInit: vi.fn(),
      getWorkflow,
      sleep: (): Promise<void> => Promise.resolve(),
      pollIntervalMs: 10,
      timeoutMs: 10_000,
      now: (): number => 0,
    };
    const { createWorkflowCommand } = await import("../../src/commands/workflow.js");
    await createWorkflowCommand(deps).parseAsync(["node", "workflow", "watch"]);
    const out = stdoutWrites.join("");
    expect(out).toContain("ready");
    expect(out).toContain("2 nodes");
    expect(deps.postInit).not.toHaveBeenCalled();
    expect(process.exitCode).not.toBe(1);
  });

  it("reports current status and exits when the workflow is already past spec", async () => {
    const deps = {
      postInit: vi.fn(),
      getWorkflow: vi.fn().mockResolvedValue({
        id: "wf_done",
        status: "building",
        description: "x",
        graph: { nodes: { a: {} }, edges: [], topology: "linear" },
      }),
      sleep: (): Promise<void> => Promise.resolve(),
      pollIntervalMs: 10,
      timeoutMs: 10_000,
      now: (): number => 0,
    };
    const { createWorkflowCommand } = await import("../../src/commands/workflow.js");
    await createWorkflowCommand(deps).parseAsync(["node", "workflow", "watch"]);
    expect(deps.getWorkflow).toHaveBeenCalledTimes(1); // no polling loop
    const out = stdoutWrites.join("");
    expect(out).toContain("wf_done");
    expect(out).toContain("building");
  });

  it("fails with E_NO_WORKFLOW when no workflow is active", async () => {
    const deps = {
      postInit: vi.fn(),
      getWorkflow: vi.fn().mockResolvedValue(null),
      sleep: (): Promise<void> => Promise.resolve(),
      pollIntervalMs: 10,
      timeoutMs: 10_000,
      now: (): number => 0,
    };
    const { createWorkflowCommand } = await import("../../src/commands/workflow.js");
    await createWorkflowCommand(deps).parseAsync(["node", "workflow", "watch"]);
    expect(process.exitCode).toBe(1);
    const err = stderrWrites.join("");
    expect(err).toContain("E_NO_WORKFLOW");
  });
});
