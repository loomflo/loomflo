import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WebSocketClient,
  WS_SUBPROTOCOL_PREFIX,
  wsSubprotocols,
  wsUrl,
} from "../../src/lib/ws.js";
import type { WsEvent } from "../../src/lib/types.js";

describe("wsUrl", () => {
  it("rewrites http → ws", () => {
    expect(wsUrl("http://localhost:3000")).toBe("ws://localhost:3000/ws");
  });

  it("rewrites https → wss", () => {
    expect(wsUrl("https://daemon.example.com")).toBe("wss://daemon.example.com/ws");
  });

  it("strips the existing query string", () => {
    expect(wsUrl("http://localhost:3000/?foo=1")).toBe("ws://localhost:3000/ws");
  });

  it("forces /ws as the path", () => {
    expect(wsUrl("http://localhost:3000/anything")).toBe("ws://localhost:3000/ws");
  });
});

describe("wsSubprotocols", () => {
  it("returns the prefix and the token, in order", () => {
    expect(wsSubprotocols("abc")).toEqual([WS_SUBPROTOCOL_PREFIX, "abc"]);
  });
});

// ---------------------------------------------------------------------------
// WebSocketClient — exercised through a tiny in-memory mock socket
// ---------------------------------------------------------------------------

interface MockSocket {
  url: string;
  protocols: string | string[];
  readyState: number;
  listeners: Map<string, Array<(ev: unknown) => void>>;
  sent: string[];
  closed: boolean;
  addEventListener(name: string, fn: (ev: unknown) => void): void;
  removeEventListener?(name: string, fn: (ev: unknown) => void): void;
  send(data: string): void;
  close(): void;
  fire(name: string, ev?: unknown): void;
}

const sockets: MockSocket[] = [];

function createMockSocket(url: string, protocols?: string | string[]): MockSocket {
  const sock: MockSocket = {
    url,
    protocols: protocols ?? "",
    readyState: 0,
    listeners: new Map(),
    sent: [],
    closed: false,
    addEventListener(name, fn) {
      const cur = this.listeners.get(name) ?? [];
      cur.push(fn);
      this.listeners.set(name, cur);
    },
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      this.closed = true;
      this.readyState = 3;
      this.fire("close");
    },
    fire(name, ev) {
      for (const fn of this.listeners.get(name) ?? []) fn(ev ?? {});
    },
  };
  return sock;
}

beforeEach(() => {
  sockets.length = 0;
  // Stub global WebSocket with a constructor that records all instances.
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    function MockedWS(this: MockSocket, url: string, protocols?: string | string[]) {
      const sock = createMockSocket(url, protocols);
      sockets.push(sock);
      Object.assign(this, sock);
      // Re-route methods to the recorded socket so external mutations stick.
      (this as MockSocket).addEventListener = sock.addEventListener.bind(sock);
      (this as MockSocket).send = sock.send.bind(sock);
      (this as MockSocket).close = sock.close.bind(sock);
      // Mirror state so the WebSocketClient sees readyState updates we make on the recorded socket.
      Object.defineProperty(this, "readyState", {
        get() {
          return sock.readyState;
        },
      });
      return this;
    } as unknown as typeof WebSocket;
  // Provide the readyState constants the client queries.
  (globalThis as unknown as { WebSocket: typeof WebSocket & Record<string, number> }).WebSocket.OPEN = 1;
  (
    globalThis as unknown as { WebSocket: typeof WebSocket & Record<string, number> }
  ).WebSocket.CONNECTING = 0;
  (
    globalThis as unknown as { WebSocket: typeof WebSocket & Record<string, number> }
  ).WebSocket.CLOSED = 3;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function lastSocket(): MockSocket {
  const s = sockets[sockets.length - 1];
  if (!s) throw new Error("no socket created yet");
  return s;
}

function flushOpen(socket: MockSocket): void {
  socket.readyState = 1;
  socket.fire("open");
}

describe("WebSocketClient", () => {
  it("opens with the correct URL and subprotocols", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    client.connect();
    const s = lastSocket();
    expect(s.url).toBe("ws://x/ws");
    expect(s.protocols).toEqual([WS_SUBPROTOCOL_PREFIX, "tok"]);
  });

  it("sends a subscribe { all: true } on open", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    client.connect();
    const s = lastSocket();
    flushOpen(s);
    expect(s.sent).toHaveLength(1);
    expect(JSON.parse(s.sent[0]!)).toEqual({ type: "subscribe", all: true });
  });

  it("dispatches typed events to typed handlers", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    client.connect();
    const s = lastSocket();
    flushOpen(s);

    const onNode = vi.fn();
    const onAny = vi.fn();
    client.on("node_status", onNode);
    client.on("*", onAny);

    const ev: WsEvent = {
      type: "node_status",
      timestamp: "2024-01-01T00:00:00Z",
      nodeId: "n1",
      status: "running",
    };
    s.fire("message", { data: JSON.stringify(ev) });

    expect(onNode).toHaveBeenCalledWith(ev);
    expect(onAny).toHaveBeenCalledWith(ev);
  });

  it("ignores malformed payloads", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    client.connect();
    const s = lastSocket();
    flushOpen(s);

    const onAny = vi.fn();
    client.on("*", onAny);
    s.fire("message", { data: "not json" });
    s.fire("message", { data: JSON.stringify({}) }); // missing type
    s.fire("message", { data: JSON.stringify({ type: 5 }) }); // wrong type
    expect(onAny).not.toHaveBeenCalled();
  });

  it("on() returns an off() that unsubscribes", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    client.connect();
    const s = lastSocket();
    flushOpen(s);

    const onNode = vi.fn();
    const off = client.on("node_status", onNode);
    off();

    s.fire("message", {
      data: JSON.stringify({ type: "node_status", timestamp: "t", nodeId: "n", status: "done" }),
    });
    expect(onNode).not.toHaveBeenCalled();
  });

  it("setSubscription replays after reconnect", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    client.connect();
    const s1 = lastSocket();
    flushOpen(s1);
    client.setSubscription({ projectIds: ["p1"] });
    expect(JSON.parse(s1.sent[s1.sent.length - 1]!)).toEqual({
      type: "subscribe",
      projectIds: ["p1"],
    });

    s1.fire("close");
    vi.advanceTimersByTime(2000);
    const s2 = lastSocket();
    expect(s2).not.toBe(s1);
    flushOpen(s2);
    // First message after reopen should be the saved subscription.
    expect(JSON.parse(s2.sent[0]!)).toEqual({ type: "subscribe", projectIds: ["p1"] });
  });

  it("close() prevents reconnect", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    client.connect();
    const s = lastSocket();
    flushOpen(s);
    client.close();
    vi.advanceTimersByTime(60_000);
    // Only one socket — no reconnect was scheduled.
    expect(sockets.length).toBe(1);
    expect(client.status).toBe("closed");
  });

  it("status updates fire onStatus listeners", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    const trace: string[] = [];
    client.onStatus((s) => trace.push(s));
    client.connect();
    flushOpen(lastSocket());
    expect(trace).toEqual(["idle", "connecting", "open"]);
  });

  it("idempotent connect — does not open multiple sockets when already open", () => {
    const client = new WebSocketClient({ baseUrl: "http://x", token: "tok" });
    client.connect();
    flushOpen(lastSocket());
    const before = sockets.length;
    client.connect();
    expect(sockets.length).toBe(before);
  });
});
