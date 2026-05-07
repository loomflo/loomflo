import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeWs, makeFakeApi, type FakeApi, type FakeWs } from "./harness.js";

let api: FakeApi;
let ws: FakeWs;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
}));

import { useWorkflow } from "../../src/hooks/useWorkflow.js";
import type { Workflow } from "../../src/lib/types.js";

function makeWorkflow(): Workflow {
  return {
    id: "wf",
    status: "running",
    description: "demo",
    projectPath: "/tmp",
    graph: {
      nodes: {
        n1: {
          id: "n1",
          title: "Node 1",
          status: "pending",
          instructions: "",
          delay: "0",
          resumeAt: null,
          agents: [],
          fileOwnership: {},
          retryCount: 0,
          maxRetries: 1,
          reviewReport: null,
          cost: 0,
          startedAt: null,
          completedAt: null,
        },
      },
      edges: [],
      topology: "linear",
    },
    config: {} as Workflow["config"],
    createdAt: "t",
    updatedAt: "t",
    totalCost: 0,
  };
}

describe("useWorkflow", () => {
  it("loads the workflow on mount", async () => {
    const wf = makeWorkflow();
    api = makeFakeApi({ getWorkflow: () => Promise.resolve(wf) });
    ws = createFakeWs();
    const { result } = renderHook(() => useWorkflow("p1"));
    await waitFor(() => expect(result.current.workflow).not.toBeNull());
    expect(api.getWorkflow).toHaveBeenCalledWith("p1");
    expect(result.current.workflow!.id).toBe("wf");
  });

  it("updates a node's status on a node_status WS event", async () => {
    const wf = makeWorkflow();
    api = makeFakeApi({ getWorkflow: () => Promise.resolve(wf) });
    ws = createFakeWs();
    const { result } = renderHook(() => useWorkflow("p1"));
    await waitFor(() => expect(result.current.workflow).not.toBeNull());

    act(() => {
      ws.emit({
        type: "node_status",
        timestamp: "t2",
        projectId: "p1",
        nodeId: "n1",
        status: "running",
      });
    });

    expect(result.current.workflow!.graph.nodes.n1!.status).toBe("running");
  });

  it("ignores node_status events for other projects", async () => {
    const wf = makeWorkflow();
    api = makeFakeApi({ getWorkflow: () => Promise.resolve(wf) });
    ws = createFakeWs();
    const { result } = renderHook(() => useWorkflow("p1"));
    await waitFor(() => expect(result.current.workflow).not.toBeNull());

    act(() => {
      ws.emit({
        type: "node_status",
        timestamp: "t",
        projectId: "OTHER",
        nodeId: "n1",
        status: "running",
      });
    });
    expect(result.current.workflow!.graph.nodes.n1!.status).toBe("pending");
  });

  it("applies cost_update events", async () => {
    const wf = makeWorkflow();
    api = makeFakeApi({ getWorkflow: () => Promise.resolve(wf) });
    ws = createFakeWs();
    const { result } = renderHook(() => useWorkflow("p1"));
    await waitFor(() => expect(result.current.workflow).not.toBeNull());

    act(() => {
      ws.emit({
        type: "cost_update",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        callCost: 0.5,
        nodeCost: 1.5,
        totalCost: 7.5,
      });
    });

    expect(result.current.workflow!.totalCost).toBe(7.5);
    expect(result.current.workflow!.graph.nodes.n1!.cost).toBe(1.5);
  });

  it("does nothing when projectId is null", () => {
    api = makeFakeApi({ getWorkflow: () => Promise.resolve(makeWorkflow()) });
    ws = createFakeWs();
    renderHook(() => useWorkflow(null));
    expect(api.getWorkflow).not.toHaveBeenCalled();
  });

  it("triggers a refresh on graph_modified", async () => {
    const wf = makeWorkflow();
    let calls = 0;
    api = makeFakeApi({
      getWorkflow: () => {
        calls++;
        return Promise.resolve(wf);
      },
    });
    ws = createFakeWs();
    const { result } = renderHook(() => useWorkflow("p1"));
    await waitFor(() => expect(result.current.workflow).not.toBeNull());
    const before = calls;
    act(() => {
      ws.emit({ type: "graph_modified", timestamp: "t", projectId: "p1", action: "node_added" });
    });
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });
});
