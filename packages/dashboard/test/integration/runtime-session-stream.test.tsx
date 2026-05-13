// ============================================================================
// Integration: runtime session WS events flow into useNode.live.* and a
// downstream consumer renders the count.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { createFakeWs, makeFakeApi, type FakeApi, type FakeWs } from "../hooks/harness.js";
import type { Node as WorkflowNode } from "../../src/lib/types.js";

let api: FakeApi;
let ws: FakeWs;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
}));

import { useNode } from "../../src/hooks/useNode.js";

function makeNode(): WorkflowNode {
  return {
    id: "n1",
    title: "claude-agent node",
    status: "running",
    instructions: "",
    delay: "0",
    resumeAt: null,
    runtime: "claude-agent",
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

function Probe({ projectId, nodeId }: { projectId: string; nodeId: string }) {
  const res = useNode(projectId, nodeId);
  return (
    <div data-testid="probe">
      <span data-testid="loaded">{res.node ? "yes" : "no"}</span>
      <span data-testid="status">{res.node?.status ?? ""}</span>
      <span data-testid="sessions">{res.live.sessions.length}</span>
      <span data-testid="events">{res.live.sessionEvents.length}</span>
      <span data-testid="mcp">{res.live.mcpCalls.length}</span>
    </div>
  );
}

beforeEach(() => {
  api = makeFakeApi({ getNode: () => Promise.resolve(makeNode()) });
  ws = createFakeWs();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runtime session stream integration", () => {
  it("flows the three Phase 4b events into useNode.live", async () => {
    const { getByTestId } = render(<Probe projectId="proj_aaaaaaaa" nodeId="n1" />);
    await waitFor(() => expect(getByTestId("loaded").textContent).toBe("yes"));

    act(() => {
      ws.emit({
        type: "runtime_session_started",
        timestamp: "t",
        projectId: "proj_aaaaaaaa",
        nodeId: "n1",
        agentId: "a1",
        runtimeName: "claude-agent",
        sessionId: "s1",
        model: "claude-sonnet",
      });
      ws.emit({
        type: "runtime_session_event",
        timestamp: "t",
        projectId: "proj_aaaaaaaa",
        nodeId: "n1",
        agentId: "a1",
        sessionId: "s1",
        event: { delta: "Hello, " },
      });
      ws.emit({
        type: "runtime_session_event",
        timestamp: "t",
        projectId: "proj_aaaaaaaa",
        nodeId: "n1",
        agentId: "a1",
        sessionId: "s1",
        event: { delta: "world!" },
      });
      ws.emit({
        type: "mcp_tool_called",
        timestamp: "t",
        projectId: "proj_aaaaaaaa",
        nodeId: "n1",
        agentId: "a1",
        toolName: "fs_write",
        input: { path: "/tmp/x" },
      });
    });

    expect(getByTestId("sessions").textContent).toBe("1");
    expect(getByTestId("events").textContent).toBe("2");
    expect(getByTestId("mcp").textContent).toBe("1");
  });
});
