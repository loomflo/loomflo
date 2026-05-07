import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeFakeApi, type FakeApi } from "./harness.js";

let api: FakeApi;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
}));

import { useRuntimes, useRuntimeAvailability, useRuntimeModels } from "../../src/hooks/useRuntimes.js";

describe("useRuntimes", () => {
  it("returns the runtime list", async () => {
    api = makeFakeApi({
      listRuntimes: () =>
        Promise.resolve({ runtimes: [{ name: "claude-agent", displayName: "Claude", registered: true }] }),
    });
    const { result } = renderHook(() => useRuntimes());
    await waitFor(() => expect(result.current.runtimes).toHaveLength(1));
  });
});

describe("useRuntimeAvailability", () => {
  it("returns clis", async () => {
    api = makeFakeApi({
      runtimeAvailability: () =>
        Promise.resolve({
          clis: { "claude-code": { installed: true, authenticated: true } },
        }),
    });
    const { result } = renderHook(() => useRuntimeAvailability());
    await waitFor(() => expect(result.current.clis["claude-code"]).toBeDefined());
  });
});

describe("useRuntimeModels", () => {
  it("returns an empty list when name is null", async () => {
    api = makeFakeApi({ runtimeModels: () => Promise.resolve({ models: [{ id: "x" }] }) });
    const { result } = renderHook(() => useRuntimeModels(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.models).toHaveLength(0);
    expect(api.runtimeModels).not.toHaveBeenCalled();
  });

  it("fetches models when given a name", async () => {
    api = makeFakeApi({
      runtimeModels: () =>
        Promise.resolve({
          models: [{ id: "claude-sonnet", displayName: "S", provider: "anthropic", available: true }],
        }),
    });
    const { result } = renderHook(() => useRuntimeModels("claude-agent"));
    await waitFor(() => expect(result.current.models).toHaveLength(1));
  });
});
