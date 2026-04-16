import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

class FakeSocket {
  static last: FakeSocket;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(public url: string) {
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
});
