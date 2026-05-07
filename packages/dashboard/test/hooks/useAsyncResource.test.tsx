import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAsyncResource } from "../../src/hooks/useAsyncResource.js";

describe("useAsyncResource", () => {
  it("loads data and exposes it on data", async () => {
    const { result } = renderHook(() => useAsyncResource(() => Promise.resolve(42), []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(42);
  });

  it("captures errors", async () => {
    const { result } = renderHook(() =>
      useAsyncResource(() => Promise.reject(new Error("boom")), []),
    );
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
  });

  it("converts non-Error rejections", async () => {
    const { result } = renderHook(() => useAsyncResource(() => Promise.reject("plain"), []));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.error?.message).toBe("plain");
  });

  it("set() can take a value or an updater function", async () => {
    const { result } = renderHook(() => useAsyncResource(() => Promise.resolve(1), []));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.set(2));
    expect(result.current.data).toBe(2);
    act(() => result.current.set((p) => (p ?? 0) + 10));
    expect(result.current.data).toBe(12);
  });

  it("refresh re-runs the fetcher", async () => {
    let n = 0;
    const { result } = renderHook(() =>
      useAsyncResource(() => Promise.resolve(++n), []),
    );
    await waitFor(() => expect(result.current.data).toBe(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toBe(2);
  });
});
