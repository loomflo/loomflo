import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeWs, makeFakeApi, type FakeApi, type FakeWs } from "./harness.js";

let api: FakeApi;
let ws: FakeWs;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
}));

import { useProjectsApi } from "../../src/hooks/useProjectsApi.js";

describe("useProjectsApi", () => {
  it("returns the project list", async () => {
    api = makeFakeApi({ listProjects: () => Promise.resolve([{ id: "p1" }]) });
    ws = createFakeWs();
    const { result } = renderHook(() => useProjectsApi());
    await waitFor(() => expect(result.current.projects).toHaveLength(1));
  });

  it("refreshes on graph_modified or runtime_session_started", async () => {
    let calls = 0;
    api = makeFakeApi({
      listProjects: () => {
        calls++;
        return Promise.resolve([]);
      },
    });
    ws = createFakeWs();
    renderHook(() => useProjectsApi());
    await waitFor(() => expect(calls).toBe(1));

    act(() => {
      ws.emit({
        type: "graph_modified",
        timestamp: "t",
        action: "node_added",
      });
    });
    await waitFor(() => expect(calls).toBe(2));

    act(() => {
      ws.emit({
        type: "runtime_session_started",
        timestamp: "t",
        nodeId: "n",
        agentId: "a",
        runtimeName: "claude-agent",
        sessionId: "s",
      });
    });
    await waitFor(() => expect(calls).toBe(3));
  });
});
