import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeFakeApi, type FakeApi } from "./harness.js";

let api: FakeApi;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
}));

import { useMcp } from "../../src/hooks/useMcp.js";

describe("useMcp", () => {
  it("loads servers per project", async () => {
    api = makeFakeApi({
      listMcp: () =>
        Promise.resolve({
          servers: { fs: { type: "stdio", enabled: true, command: "fs" } },
        }),
    });
    const { result } = renderHook(() => useMcp("p1"));
    await waitFor(() => expect(Object.keys(result.current.servers)).toHaveLength(1));
  });

  it("upsert calls the daemon", async () => {
    api = makeFakeApi({
      listMcp: () => Promise.resolve({ servers: {} }),
      upsertMcp: () => Promise.resolve(undefined),
    });
    const { result } = renderHook(() => useMcp("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.upsert("fs", { type: "stdio", enabled: true });
    });
    expect(api.upsertMcp).toHaveBeenCalledWith("p1", "fs", { type: "stdio", enabled: true });
  });

  it("remove calls the daemon", async () => {
    api = makeFakeApi({
      listMcp: () => Promise.resolve({ servers: {} }),
      deleteMcp: () => Promise.resolve(undefined),
    });
    const { result } = renderHook(() => useMcp("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.remove("fs");
    });
    expect(api.deleteMcp).toHaveBeenCalledWith("p1", "fs");
  });

  it("upsert/remove are no-ops without a projectId", async () => {
    api = makeFakeApi({
      listMcp: () => Promise.resolve({ servers: {} }),
      upsertMcp: () => Promise.resolve(undefined),
      deleteMcp: () => Promise.resolve(undefined),
    });
    const { result } = renderHook(() => useMcp(null));
    await act(async () => {
      await result.current.upsert("fs", { type: "stdio", enabled: true });
      await result.current.remove("fs");
    });
    expect(api.upsertMcp).not.toHaveBeenCalled();
    expect(api.deleteMcp).not.toHaveBeenCalled();
  });
});
