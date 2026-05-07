import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeFakeApi, type FakeApi } from "./harness.js";

let api: FakeApi;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
}));

import { useCredentials } from "../../src/hooks/useCredentials.js";

describe("useCredentials", () => {
  it("loads credentials", async () => {
    api = makeFakeApi({
      listCredentials: () =>
        Promise.resolve({ credentials: [{ name: "x", type: "anthropic-oauth" }] }),
    });
    const { result } = renderHook(() => useCredentials());
    await waitFor(() => expect(result.current.credentials).toHaveLength(1));
  });

  it("upsert calls the daemon then refresh", async () => {
    let listed = 0;
    api = makeFakeApi({
      listCredentials: () => {
        listed++;
        return Promise.resolve({ credentials: [] });
      },
      upsertCredential: () =>
        Promise.resolve({ credential: { name: "x", type: "anthropic-oauth" } }),
    });
    const { result } = renderHook(() => useCredentials());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = listed;
    await act(async () => {
      await result.current.upsert("x", { type: "anthropic-oauth" });
    });
    expect(api.upsertCredential).toHaveBeenCalledWith("x", { type: "anthropic-oauth" });
    expect(listed).toBeGreaterThan(before);
  });

  it("remove calls deleteCredential then refresh", async () => {
    api = makeFakeApi({
      listCredentials: () => Promise.resolve({ credentials: [] }),
      deleteCredential: () => Promise.resolve(undefined),
    });
    const { result } = renderHook(() => useCredentials());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.remove("x");
    });
    expect(api.deleteCredential).toHaveBeenCalledWith("x");
  });
});
