import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeFakeApi, type FakeApi } from "./harness.js";
import type { Config } from "../../src/lib/types.js";

let api: FakeApi;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
}));

import { useConfig } from "../../src/hooks/useConfig.js";

const seed = { level: 1, defaultDelay: "10m" } as unknown as Config;

describe("useConfig", () => {
  it("loads config", async () => {
    api = makeFakeApi({ getConfig: () => Promise.resolve({ config: seed }) });
    const { result } = renderHook(() => useConfig("p1"));
    await waitFor(() => expect(result.current.config).not.toBeNull());
  });

  it("update applies the new config locally and calls the daemon", async () => {
    api = makeFakeApi({
      getConfig: () => Promise.resolve({ config: seed }),
      updateConfig: () =>
        Promise.resolve({ config: { ...seed, level: 2 } }),
    });
    const { result } = renderHook(() => useConfig("p1"));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    await act(async () => {
      await result.current.update({ level: 2 });
    });
    expect(api.updateConfig).toHaveBeenCalledWith("p1", { level: 2 });
    expect(result.current.config!.level).toBe(2);
  });

  it("update throws when projectId is missing", async () => {
    api = makeFakeApi({
      getConfig: () => Promise.resolve({ config: seed }),
      updateConfig: () => Promise.resolve({ config: seed }),
    });
    const { result } = renderHook(() => useConfig(null));
    await act(async () => {
      await expect(result.current.update({ level: 2 })).rejects.toThrow();
    });
  });
});
