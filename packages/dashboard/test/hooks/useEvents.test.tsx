import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeWs, makeFakeApi, type FakeApi, type FakeWs } from "./harness.js";

let api: FakeApi;
let ws: FakeWs;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
}));

import { useEvents } from "../../src/hooks/useEvents.js";

describe("useEvents", () => {
  it("loads events with the provided filter", async () => {
    api = makeFakeApi({
      getEvents: () =>
        Promise.resolve({
          events: [
            {
              ts: "t1",
              type: "node_started",
              workflowId: "wf",
              nodeId: "n1",
              agentId: null,
              details: {},
            },
          ],
          total: 1,
        }),
    });
    ws = createFakeWs();
    const { result } = renderHook(() =>
      useEvents({ projectId: "p1", type: "node_started", limit: 10 }),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(api.getEvents).toHaveBeenCalledWith("p1", { type: "node_started", limit: 10 });
  });

  it("does not fetch when projectId is null", () => {
    api = makeFakeApi({ getEvents: () => Promise.resolve({ events: [], total: 0 }) });
    ws = createFakeWs();
    renderHook(() => useEvents({ projectId: null }));
    expect(api.getEvents).not.toHaveBeenCalled();
  });

  it("refreshes the list on any matching WS event", async () => {
    let calls = 0;
    api = makeFakeApi({
      getEvents: () => {
        calls++;
        return Promise.resolve({ events: [], total: calls });
      },
    });
    ws = createFakeWs();
    const { result } = renderHook(() => useEvents({ projectId: "p1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initial = calls;
    act(() => {
      ws.emit({
        type: "node_status",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        status: "running",
      });
    });
    await waitFor(() => expect(calls).toBeGreaterThan(initial));
  });

  it("ignores events from other projects", async () => {
    let calls = 0;
    api = makeFakeApi({
      getEvents: () => {
        calls++;
        return Promise.resolve({ events: [], total: 0 });
      },
    });
    ws = createFakeWs();
    renderHook(() => useEvents({ projectId: "p1" }));
    await waitFor(() => expect(calls).toBe(1));
    act(() => {
      ws.emit({
        type: "node_status",
        timestamp: "t",
        projectId: "OTHER",
        nodeId: "n1",
        status: "running",
      });
    });
    // No additional fetch
    expect(calls).toBe(1);
  });
});
