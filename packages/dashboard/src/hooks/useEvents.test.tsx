// ============================================================================
// useEvents — WS subscription stability + debounce regression tests
// ============================================================================

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEvents } from "./useEvents.js";

interface FakeApi {
  getEvents: ReturnType<typeof vi.fn>;
}

interface FakeWs {
  on: ReturnType<typeof vi.fn>;
}

const fakeApi: FakeApi = {
  getEvents: vi.fn(),
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
  fakeApi.getEvents.mockReset();
  fakeApi.getEvents.mockResolvedValue({ events: [], total: 0 });
  fakeWs.on.mockClear();
  offSpy.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEvents", () => {
  it("does not re-subscribe on each render of the parent", async () => {
    const { rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useEvents({ projectId }),
      { initialProps: { projectId: "proj_aaaa1111" } },
    );

    await act(async () => {
      await Promise.resolve();
    });

    const initialOnCalls = fakeWs.on.mock.calls.length;

    rerender({ projectId: "proj_aaaa1111" });
    rerender({ projectId: "proj_aaaa1111" });
    rerender({ projectId: "proj_aaaa1111" });

    expect(fakeWs.on.mock.calls.length).toBe(initialOnCalls);
    expect(offSpy).not.toHaveBeenCalled();
  });

  it("debounces rapid WS bursts into a single refresh", async () => {
    type WsHandler = (ev: { projectId?: string }) => void;
    const captured: { handler: WsHandler | null } = { handler: null };
    fakeWs.on.mockImplementation((_type: string, handler: WsHandler) => {
      captured.handler = handler;
      return offSpy;
    });

    renderHook(() => useEvents({ projectId: "proj_bbbb2222" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(fakeApi.getEvents).toHaveBeenCalledTimes(1);
    if (!captured.handler) throw new Error("ws.on handler not captured");
    const handler = captured.handler;

    act(() => {
      for (let i = 0; i < 10; i += 1) {
        handler({ projectId: "proj_bbbb2222" });
      }
    });

    expect(fakeApi.getEvents).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });

    expect(fakeApi.getEvents).toHaveBeenCalledTimes(2);
  });
});
