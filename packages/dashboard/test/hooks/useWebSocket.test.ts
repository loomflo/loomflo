import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

class FakeSocket {
  static last: FakeSocket;
  sent: string[] = [];
  readonly protocols: string[];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(public url: string, protocols?: string | string[]) {
    this.protocols = protocols === undefined ? [] : Array.isArray(protocols) ? protocols : [protocols];
    FakeSocket.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(s: string): void {
    this.sent.push(s);
  }
  close(): void {
    this.onclose?.();
  }
}

vi.stubGlobal("WebSocket", FakeSocket);

import { useWebSocket } from "../../src/hooks/useWebSocket.js";

describe("useWebSocket", () => {
  it("sends a subscribe frame with projectIds on open", async () => {
    const { result } = renderHook(() =>
      useWebSocket({ baseUrl: "http://localhost:42000", token: "t", subscribe: { projectIds: ["proj_a"] } }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(FakeSocket.last.sent[0]).toContain(`"projectIds":["proj_a"]`);
    expect(result.current.connected).toBe(true);
  });

  it("sends { all: true } when subscribe.all is set", async () => {
    renderHook(() =>
      useWebSocket({ baseUrl: "http://localhost:42000", token: "t", subscribe: { all: true } }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(FakeSocket.last.sent[0]).toContain(`"all":true`);
  });

  it("carries the token on Sec-WebSocket-Protocol, not the URL", async () => {
    renderHook(() =>
      useWebSocket({
        baseUrl: "http://localhost:42000",
        token: "browser-secret",
        subscribe: { all: true },
      }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(FakeSocket.last.url).toBe("ws://localhost:42000/ws");
    expect(FakeSocket.last.url).not.toContain("token=");
    expect(FakeSocket.last.protocols).toEqual(["loomflo.bearer", "browser-secret"]);
  });
});
