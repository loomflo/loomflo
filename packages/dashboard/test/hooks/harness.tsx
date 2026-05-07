// ============================================================================
// Test harness for hooks
//
// Each test file `vi.mock("../../src/context/AppContext.js", ...)` to make
// hook code resolve through these fakes. This avoids needing the real
// ApiClient / WebSocketClient at all in unit tests.
// ============================================================================

import { vi } from "vitest";
import type { WsEvent } from "../../src/lib/types.js";

// ---------------------------------------------------------------------------
// Fake WS bus
// ---------------------------------------------------------------------------

export interface FakeWs {
  on: (type: WsEvent["type"] | "*", handler: (ev: WsEvent) => void) => () => void;
  onStatus: (handler: (s: string) => void) => () => void;
  setSubscription: () => void;
  connect: () => void;
  close: () => void;
  status: string;
  /** Push an event to all matching handlers. */
  emit: (ev: WsEvent) => void;
}

export function createFakeWs(): FakeWs {
  const typed = new Map<string, Set<(ev: WsEvent) => void>>();
  const anyH = new Set<(ev: WsEvent) => void>();

  return {
    on(type, handler) {
      if (type === "*") {
        anyH.add(handler);
        return () => {
          anyH.delete(handler);
        };
      }
      let set = typed.get(type);
      if (!set) {
        set = new Set();
        typed.set(type, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    },
    onStatus(handler) {
      handler("open");
      return () => {};
    },
    setSubscription() {},
    connect() {},
    close() {},
    status: "open",
    emit(ev) {
      for (const fn of typed.get(ev.type) ?? []) fn(ev);
      for (const fn of anyH) fn(ev);
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: stub ApiClient. Tests pass a Partial.
// ---------------------------------------------------------------------------

export type FakeApi = Record<string, ReturnType<typeof vi.fn>>;

export function makeFakeApi(overrides: Partial<Record<string, unknown>> = {}): FakeApi {
  const fns: FakeApi = {};
  for (const [name, val] of Object.entries(overrides)) {
    fns[name] = vi.fn(typeof val === "function" ? (val as () => unknown) : () => val);
  }
  return fns;
}
