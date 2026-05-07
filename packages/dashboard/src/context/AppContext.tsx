// ============================================================================
// AppContext
//
// Provides the daemon-bound singletons (ApiClient + WebSocketClient) plus
// the token / baseUrl used to build them. Components access this through
// {@link useAppContext} and the convenience hooks {@link useApi} /
// {@link useWs}.
//
// Boot sequence:
//  1. Read token from URL hash (or sessionStorage); show fallback if absent.
//  2. Build ApiClient with optional `useMock` toggle (VITE_USE_MOCK=1).
//  3. Build WebSocketClient — connect lazily on first listener, close on
//     unmount.
//
// In mock mode the ApiClient routes project-scoped GETs to /mock/*; the
// WebSocketClient still tries to connect — the daemon serves WS even in
// mock mode, the front just receives no events until a real workflow runs.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClient } from "../lib/api.js";
import { readToken } from "../lib/token.js";
import { WebSocketClient, type WsStatus } from "../lib/ws.js";

interface AppContextValue {
  /** Daemon base URL (e.g. http://localhost:3000). */
  baseUrl: string;
  /** Bearer token, or null when none was provided. */
  token: string | null;
  /** REST client. Always provided (uses an empty token if missing). */
  apiClient: ApiClient;
  /** WebSocket client (idempotent connect). */
  wsClient: WebSocketClient;
  /** Current WS connection status, propagated for UI badges. */
  wsStatus: WsStatus;
  /** True when the client is wired to /mock/* fixtures. */
  useMock: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

function readBaseUrl(): string {
  const fromEnv = import.meta.env["VITE_API_URL"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

function readUseMock(): boolean {
  const env = import.meta.env["VITE_USE_MOCK"];
  return env === "1" || env === "true";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const baseUrl = useMemo(readBaseUrl, []);
  const useMock = useMemo(readUseMock, []);

  // readToken() must run client-side; it pulls from the URL hash on the
  // very first mount, then promotes to sessionStorage. We only call it once.
  const initialTokenRef = useRef<string | null | undefined>(undefined);
  if (initialTokenRef.current === undefined) {
    try {
      initialTokenRef.current = readToken();
    } catch {
      initialTokenRef.current = null;
    }
  }
  const token = initialTokenRef.current;

  const apiClient = useMemo(
    () =>
      new ApiClient({
        baseUrl,
        token: token ?? "",
        useMock,
      }),
    [baseUrl, token, useMock],
  );

  const wsClient = useMemo(
    () => new WebSocketClient({ baseUrl, token: token ?? "" }),
    [baseUrl, token],
  );

  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");

  useEffect(() => {
    if (!token) return;
    const off = wsClient.onStatus(setWsStatus);
    wsClient.connect();
    return () => {
      off();
      wsClient.close();
    };
  }, [wsClient, token]);

  const value = useMemo<AppContextValue>(
    () => ({
      baseUrl,
      token,
      apiClient,
      wsClient,
      wsStatus,
      useMock,
    }),
    [baseUrl, token, apiClient, wsClient, wsStatus, useMock],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside <AppProvider>");
  return ctx;
}

/** Convenience: returns the ApiClient. */
export function useApi(): ApiClient {
  return useAppContext().apiClient;
}

/** Convenience: returns the WebSocketClient. */
export function useWs(): WebSocketClient {
  return useAppContext().wsClient;
}

/** Convenience: returns the current WS status (re-renders when it changes). */
export function useWsStatus(): WsStatus {
  return useAppContext().wsStatus;
}

/** Optional: stable callback returning whether the client uses mock fixtures. */
export function useUseMock(): boolean {
  return useAppContext().useMock;
}

/** Stable refresh helper, used by hooks that re-fetch on demand. */
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: never[]) => ref.current(...args)) as T, []);
}
