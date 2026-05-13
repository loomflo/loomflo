// ============================================================================
// useCosts — WS subscription stability regression test (H1)
// ============================================================================

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCosts } from "./useCosts.js";

interface FakeApi {
  getCosts: ReturnType<typeof vi.fn>;
}

interface FakeWs {
  on: ReturnType<typeof vi.fn>;
}

const fakeApi: FakeApi = {
  getCosts: vi.fn(),
};

const offSpy = vi.fn();
const fakeWs: FakeWs = {
  on: vi.fn().mockReturnValue(offSpy),
};

vi.mock("../context/AppContext.js", () => ({
  useApi: () => fakeApi,
  useWs: () => fakeWs,
}));

beforeEach(() => {
  fakeApi.getCosts.mockReset();
  fakeApi.getCosts.mockResolvedValue({
    total: 0,
    nodes: [],
    budgetRemaining: null,
  });
  fakeWs.on.mockReset();
  fakeWs.on.mockReturnValue(offSpy);
  offSpy.mockClear();
});

describe("useCosts", () => {
  it("subscribes to cost_update once and survives multiple parent renders", async () => {
    const { rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useCosts(projectId),
      { initialProps: { projectId: "proj_cccc3333" } },
    );

    await act(async () => {
      await Promise.resolve();
    });

    const initialCalls = fakeWs.on.mock.calls.length;
    expect(initialCalls).toBe(1);
    expect(fakeWs.on.mock.calls[0]?.[0]).toBe("cost_update");

    rerender({ projectId: "proj_cccc3333" });
    rerender({ projectId: "proj_cccc3333" });
    rerender({ projectId: "proj_cccc3333" });
    rerender({ projectId: "proj_cccc3333" });

    expect(fakeWs.on.mock.calls.length).toBe(initialCalls);
    expect(offSpy).not.toHaveBeenCalled();
  });
});
