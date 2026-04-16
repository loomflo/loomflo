/**
 * Unit tests for packages/cli/src/observation/ws.ts — WebSocket subscription abstraction.
 *
 * Uses a FakeSocket + vi.mock("ws") to avoid real network I/O.
 */
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// FakeSocket — mimics a ws.WebSocket just enough for our abstraction
// ---------------------------------------------------------------------------

class FakeSocket extends EventEmitter {
  sent: string[] = [];
  readyState = 1; // OPEN
  send(m: string): void {
    this.sent.push(m);
  }
  close(): void {
    this.emit("close");
  }
}

// ---------------------------------------------------------------------------
// Mock the "ws" module so openSubscription never opens a real socket
// ---------------------------------------------------------------------------

vi.mock("ws", () => ({
  default: class {
    constructor() {
      const s = new FakeSocket();
      // Simulate async open
      setTimeout(() => s.emit("open"), 0);
      return s as unknown as never;
    }
  },
}));

// ---------------------------------------------------------------------------
// Import after mock is established
// ---------------------------------------------------------------------------

import { openSubscription } from "../../../src/observation/ws.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("openSubscription", () => {
  it("sends a subscribe frame on open with { all: true }", async () => {
    const sub = await openSubscription({ port: 42000, token: "t" }, { all: true });
    expect(sub).toBeDefined();
    const socket = (sub as unknown as { _socket: FakeSocket })._socket;
    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    expect(frame).toMatchObject({ type: "subscribe", all: true });
    sub.close();
  });

  it("sends a subscribe frame with specific projectIds", async () => {
    const sub = await openSubscription(
      { port: 42000, token: "tok" },
      { projectIds: ["p1", "p2"] },
    );
    const socket = (sub as unknown as { _socket: FakeSocket })._socket;
    const frame = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    expect(frame).toMatchObject({ type: "subscribe", projectIds: ["p1", "p2"] });
    sub.close();
  });

  it("invokes onMessage callback when a message arrives", async () => {
    const sub = await openSubscription({ port: 42000, token: "t" }, { all: true });
    const socket = (sub as unknown as { _socket: FakeSocket })._socket;

    const messages: unknown[] = [];
    sub.onMessage((data) => messages.push(data));

    // Simulate server sending a message
    socket.emit("message", JSON.stringify({ type: "node_status", nodeId: "n1" }));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "node_status", nodeId: "n1" });
    sub.close();
  });

  it("invokes onClose callback when the socket closes", async () => {
    const sub = await openSubscription({ port: 42000, token: "t" }, { all: true });

    let closed = false;
    sub.onClose(() => {
      closed = true;
    });

    sub.close();
    expect(closed).toBe(true);
  });
});
