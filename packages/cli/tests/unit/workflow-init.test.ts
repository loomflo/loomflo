import { describe, expect, it, vi } from "vitest";

import {
  runWorkflowInit,
  type WorkflowInitDeps,
  type WorkflowState,
} from "../../src/workflow-init.js";
import type { DaemonInfo } from "../../src/daemon-control.js";

const INFO: DaemonInfo = { port: 42000, token: "t", pid: 1, version: "0.3.0" };

function makeDeps(overrides: Partial<WorkflowInitDeps> = {}): WorkflowInitDeps {
  return {
    postInit: vi.fn().mockResolvedValue({ id: "wf_1", status: "spec", description: "d" }),
    getWorkflow: vi.fn().mockResolvedValue({
      id: "wf_1",
      status: "building",
      description: "d",
      graph: { nodes: { a: {}, b: {}, c: {} }, edges: [], topology: "linear" },
    } satisfies WorkflowState),
    sleep: (): Promise<void> => Promise.resolve(),
    pollIntervalMs: 10,
    timeoutMs: 10_000,
    now: (): number => 0,
    ...overrides,
  };
}

describe("runWorkflowInit", () => {
  it("happy path — transitions from spec to building and reports node count", async () => {
    const states: WorkflowState[] = [
      {
        id: "wf_1",
        status: "spec",
        description: "d",
        graph: { nodes: {}, edges: [], topology: "linear" },
      },
      {
        id: "wf_1",
        status: "building",
        description: "d",
        graph: { nodes: { a: {}, b: {} }, edges: [], topology: "linear" },
      },
    ];
    const getWorkflow = vi.fn().mockImplementation(async () => states.shift() ?? states[states.length - 1]);
    const deps = makeDeps({ getWorkflow });

    const result = await runWorkflowInit(
      { info: INFO, projectId: "p", projectPath: "/tmp/p", description: "make thing" },
      deps,
    );

    expect(result).toEqual({ id: "wf_1", status: "building", nodeCount: 2 });
    expect(deps.postInit).toHaveBeenCalledWith(INFO, "p", {
      description: "make thing",
      projectPath: "/tmp/p",
    });
  });

  it("throws E_WORKFLOW_FAILED when the daemon reports failed status", async () => {
    const deps = makeDeps({
      getWorkflow: vi.fn().mockResolvedValue({
        id: "wf_1",
        status: "failed",
        description: "d",
        graph: { nodes: {}, edges: [], topology: "linear" },
      }),
    });
    await expect(
      runWorkflowInit(
        { info: INFO, projectId: "p", projectPath: "/tmp/p", description: "x" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "E_WORKFLOW_FAILED" });
  });

  it("tags 409 conflicts with code E_WORKFLOW_CONFLICT and does not poll", async () => {
    const conflict = Object.assign(new Error("A workflow is already active"), { status: 409 });
    const getWorkflow = vi.fn();
    const deps = makeDeps({
      postInit: vi.fn().mockRejectedValue(conflict),
      getWorkflow,
    });
    await expect(
      runWorkflowInit(
        { info: INFO, projectId: "p", projectPath: "/tmp/p", description: "x" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "E_WORKFLOW_CONFLICT" });
    expect(getWorkflow).not.toHaveBeenCalled();
  });

  it("throws E_WORKFLOW_TIMEOUT when spec generation never advances", async () => {
    let t = 0;
    const deps = makeDeps({
      getWorkflow: vi.fn().mockResolvedValue({
        id: "wf_1",
        status: "spec",
        description: "d",
        graph: { nodes: {}, edges: [], topology: "linear" },
      }),
      now: (): number => t,
      sleep: (ms: number): Promise<void> => {
        t += ms;
        return Promise.resolve();
      },
      pollIntervalMs: 100,
      timeoutMs: 500,
    });
    await expect(
      runWorkflowInit(
        { info: INFO, projectId: "p", projectPath: "/tmp/p", description: "x" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "E_WORKFLOW_TIMEOUT" });
  });
});
