import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppProvider,
  useApi,
  useAppContext,
  useUseMock,
  useWs,
} from "../../src/context/AppContext.js";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, "", "http://localhost:3000/");
  // Stub WebSocket so AppProvider's connect() doesn't open a real socket.
  class StubSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    readyState = 0;
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  }
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    StubSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("AppProvider", () => {
  it("exposes ApiClient + WebSocketClient + token", () => {
    sessionStorage.setItem("loomflo.token", "abc");
    const { result } = renderHook(() => useAppContext(), { wrapper: AppProvider });
    expect(result.current.token).toBe("abc");
    expect(result.current.apiClient).toBeDefined();
    expect(result.current.wsClient).toBeDefined();
  });

  it("returns null token when none is available", () => {
    const { result } = renderHook(() => useAppContext(), { wrapper: AppProvider });
    expect(result.current.token).toBeNull();
  });

  it("useApi / useWs / useUseMock helpers return the right slices", () => {
    sessionStorage.setItem("loomflo.token", "x");
    const { result: apiResult } = renderHook(() => useApi(), { wrapper: AppProvider });
    expect(apiResult.current).toBeDefined();
    const { result: wsResult } = renderHook(() => useWs(), { wrapper: AppProvider });
    expect(wsResult.current).toBeDefined();
    const { result: mockResult } = renderHook(() => useUseMock(), { wrapper: AppProvider });
    expect(mockResult.current).toBe(false);
  });

  it("throws when useAppContext is used outside the provider", () => {
    expect(() => renderHook(() => useAppContext())).toThrow();
  });

  it("derives ApiClient.useMock from VITE_USE_MOCK env (defaults to false)", () => {
    sessionStorage.setItem("loomflo.token", "x");
    const { result } = renderHook(() => useAppContext(), { wrapper: AppProvider });
    expect(result.current.apiClient.useMock).toBe(false);
  });
});
