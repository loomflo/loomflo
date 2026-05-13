import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeWs, makeFakeApi, type FakeApi, type FakeWs } from "./harness.js";

let api: FakeApi;
let ws: FakeWs;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
}));

import { useNode } from "../../src/hooks/useNode.js";
import type { Node } from "../../src/lib/types.js";

function makeNode(): Node {
  return {
    id: "n1",
    title: "N1",
    status: "pending",
    instructions: "",
    delay: "0",
    resumeAt: null,
    agents: [
      {
        id: "a1",
        role: "looma",
        model: "claude-sonnet",
        status: "created",
        writeScope: [],
        taskDescription: "",
        tokenUsage: { input: 0, output: 0 },
        cost: 0,
      },
    ],
    fileOwnership: {},
    retryCount: 0,
    maxRetries: 1,
    reviewReport: null,
    cost: 0,
    startedAt: null,
    completedAt: null,
  };
}

describe("useNode", () => {
  it("loads the node on mount", async () => {
    api = makeFakeApi({ getNode: () => Promise.resolve(makeNode()) });
    ws = createFakeWs();
    const { result } = renderHook(() => useNode("p1", "n1"));
    await waitFor(() => expect(result.current.node).not.toBeNull());
    expect(api.getNode).toHaveBeenCalledWith("p1", "n1");
  });

  it("applies node_status events", async () => {
    api = makeFakeApi({ getNode: () => Promise.resolve(makeNode()) });
    ws = createFakeWs();
    const { result } = renderHook(() => useNode("p1", "n1"));
    await waitFor(() => expect(result.current.node).not.toBeNull());
    act(() => {
      ws.emit({
        type: "node_status",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        status: "done",
      });
    });
    expect(result.current.node!.status).toBe("done");
  });

  it("updates an agent's status from agent_status", async () => {
    api = makeFakeApi({ getNode: () => Promise.resolve(makeNode()) });
    ws = createFakeWs();
    const { result } = renderHook(() => useNode("p1", "n1"));
    await waitFor(() => expect(result.current.node).not.toBeNull());
    act(() => {
      ws.emit({
        type: "agent_status",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        agentId: "a1",
        status: "completed",
      });
    });
    expect(result.current.node!.agents[0]!.status).toBe("completed");
  });

  it("appends runtime_session_event to live.sessionEvents", async () => {
    api = makeFakeApi({ getNode: () => Promise.resolve(makeNode()) });
    ws = createFakeWs();
    const { result } = renderHook(() => useNode("p1", "n1"));
    await waitFor(() => expect(result.current.node).not.toBeNull());
    act(() => {
      ws.emit({
        type: "runtime_session_event",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        agentId: "a1",
        sessionId: "s",
        event: { delta: "hello" },
      });
    });
    expect(result.current.live.sessionEvents).toHaveLength(1);
  });

  it("appends mcp_tool_called to live.mcpCalls and runtime_session_started to live.sessions", async () => {
    api = makeFakeApi({ getNode: () => Promise.resolve(makeNode()) });
    ws = createFakeWs();
    const { result } = renderHook(() => useNode("p1", "n1"));
    await waitFor(() => expect(result.current.node).not.toBeNull());
    act(() => {
      ws.emit({
        type: "runtime_session_started",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        agentId: "a1",
        runtimeName: "claude-agent",
        sessionId: "s",
      });
      ws.emit({
        type: "mcp_tool_called",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        agentId: "a1",
        toolName: "fs_write",
        input: { path: "/tmp/x" },
      });
    });
    expect(result.current.live.sessions).toHaveLength(1);
    expect(result.current.live.mcpCalls).toHaveLength(1);
  });

  it("ignores events for other nodes", async () => {
    api = makeFakeApi({ getNode: () => Promise.resolve(makeNode()) });
    ws = createFakeWs();
    const { result } = renderHook(() => useNode("p1", "n1"));
    await waitFor(() => expect(result.current.node).not.toBeNull());
    act(() => {
      ws.emit({
        type: "node_status",
        timestamp: "t",
        projectId: "p1",
        nodeId: "OTHER",
        status: "running",
      });
    });
    expect(result.current.node!.status).toBe("pending");
  });

  it("applies cost_update", async () => {
    api = makeFakeApi({ getNode: () => Promise.resolve(makeNode()) });
    ws = createFakeWs();
    const { result } = renderHook(() => useNode("p1", "n1"));
    await waitFor(() => expect(result.current.node).not.toBeNull());
    act(() => {
      ws.emit({
        type: "cost_update",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        callCost: 1,
        nodeCost: 3.14,
        totalCost: 10,
      });
    });
    expect(result.current.node!.cost).toBe(3.14);
  });
});
