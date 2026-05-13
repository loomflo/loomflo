import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeWs, makeFakeApi, type FakeApi, type FakeWs } from "./harness.js";

let api: FakeApi;
let ws: FakeWs;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
}));

import { useCosts } from "../../src/hooks/useCosts.js";

const seed = {
  total: 1,
  budgetLimit: 10,
  budgetRemaining: 9,
  nodes: [{ id: "n1", title: "N1", cost: 1, retries: 0 }],
  loomCost: 0,
};

describe("useCosts", () => {
  it("loads costs", async () => {
    api = makeFakeApi({ getCosts: () => Promise.resolve(seed) });
    ws = createFakeWs();
    const { result } = renderHook(() => useCosts("p1"));
    await waitFor(() => expect(result.current.costs).not.toBeNull());
    expect(result.current.costs!.total).toBe(1);
  });

  it("applies cost_update events", async () => {
    api = makeFakeApi({ getCosts: () => Promise.resolve(seed) });
    ws = createFakeWs();
    const { result } = renderHook(() => useCosts("p1"));
    await waitFor(() => expect(result.current.costs).not.toBeNull());
    act(() => {
      ws.emit({
        type: "cost_update",
        timestamp: "t",
        projectId: "p1",
        nodeId: "n1",
        callCost: 0.5,
        nodeCost: 1.5,
        totalCost: 2.5,
        budgetRemaining: 7.5,
      });
    });
    expect(result.current.costs!.total).toBe(2.5);
    expect(result.current.costs!.nodes[0]!.cost).toBe(1.5);
    expect(result.current.costs!.budgetRemaining).toBe(7.5);
  });

  it("ignores other projects", async () => {
    api = makeFakeApi({ getCosts: () => Promise.resolve(seed) });
    ws = createFakeWs();
    const { result } = renderHook(() => useCosts("p1"));
    await waitFor(() => expect(result.current.costs).not.toBeNull());
    act(() => {
      ws.emit({
        type: "cost_update",
        timestamp: "t",
        projectId: "OTHER",
        nodeId: "n1",
        callCost: 1,
        nodeCost: 99,
        totalCost: 99,
      });
    });
    expect(result.current.costs!.total).toBe(1);
  });
});
