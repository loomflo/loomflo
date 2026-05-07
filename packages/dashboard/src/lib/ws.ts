// ============================================================================
// WebSocket client
//
// Wraps a native WebSocket with the Loomflo bearer-subprotocol auth pattern,
// reconnect-with-exponential-backoff, and a typed `on(type, handler)` API
// over the WsEvent discriminated union.
// ============================================================================

import type { WsEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Subprotocol auth helpers
// ---------------------------------------------------------------------------

/**
 * Subprotocol identifier paired with the bearer token on the WebSocket
 * upgrade request (`Sec-WebSocket-Protocol: loomflo.bearer, <token>`).
 *
 * Keeping the token off the URL avoids browser history, DevTools Network
 * panels, and reverse-proxy access logs holding it in clear text.
 */
export const WS_SUBPROTOCOL_PREFIX = "loomflo.bearer";

/** Build the daemon WebSocket URL (no query string — auth rides in the subprotocol). */
export function wsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol.startsWith("https") ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = "";
  return u.toString();
}

/** Build the ordered subprotocol list the browser sends on the WS upgrade. */
export function wsSubprotocols(token: string): [string, string] {
  return [WS_SUBPROTOCOL_PREFIX, token];
}

// ---------------------------------------------------------------------------
// Typed client
// ---------------------------------------------------------------------------

export type SubscribeSpec = { all: true } | { projectIds: string[] };

type AnyHandler = (ev: WsEvent) => void;

type TypedHandler<T extends WsEvent["type"]> = (ev: Extract<WsEvent, { type: T }>) => void;

/** Connection state surfaced by the client. */
export type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

/**
 * WebSocketClient wraps a single WebSocket and exposes:
 * - `on(type, handler)` typed via the WsEvent discriminator
 * - `setSubscription(spec)` — replays after reconnects
 * - `connect()` / `close()` — manual lifecycle
 * - automatic reconnection with capped exponential backoff
 */
export class WebSocketClient {
  private readonly url: string;
  private readonly token: string;
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private subscription: SubscribeSpec = { all: true };
  private readonly typedHandlers = new Map<string, Set<AnyHandler>>();
  private readonly anyHandlers = new Set<AnyHandler>();
  private readonly statusListeners = new Set<(s: WsStatus) => void>();
  private currentStatus: WsStatus = "idle";
  private closedByUser = false;

  constructor(opts: { baseUrl: string; token: string }) {
    this.url = wsUrl(opts.baseUrl);
    this.token = opts.token;
  }

  /** Current connection status (one of "idle"|"connecting"|"open"|"closed"|"error"). */
  get status(): WsStatus {
    return this.currentStatus;
  }

  /** Open the connection. Idempotent — reuses an existing socket when alive. */
  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUser = false;
    this.setStatus("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url, wsSubprotocols(this.token));
    } catch (err) {
      this.setStatus("error");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.setStatus("open");
      this.send({ type: "subscribe", ...this.subscription });
    });

    socket.addEventListener("message", (msgEvent) => {
      const raw = msgEvent.data;
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as { type?: unknown }).type !== "string"
      ) {
        return;
      }
      const ev = parsed as WsEvent;
      const set = this.typedHandlers.get(ev.type);
      if (set) {
        for (const handler of set) handler(ev);
      }
      for (const handler of this.anyHandlers) handler(ev);
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      if (this.closedByUser) {
        this.setStatus("closed");
        return;
      }
      this.setStatus("closed");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      this.setStatus("error");
      // The "close" event fires after "error" — reconnect logic runs there.
    });
  }

  /** Close the connection and cancel any pending reconnect. */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  /** Replace the current subscription. Re-sent automatically on reconnect. */
  setSubscription(spec: SubscribeSpec): void {
    this.subscription = spec;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: "subscribe", ...spec });
    }
  }

  /** Subscribe to a single event type, or `*` for all events. Returns an off() function. */
  on<T extends WsEvent["type"]>(type: T, handler: TypedHandler<T>): () => void;
  on(type: "*", handler: AnyHandler): () => void;
  on(type: WsEvent["type"] | "*", handler: AnyHandler): () => void {
    if (type === "*") {
      this.anyHandlers.add(handler);
      return () => {
        this.anyHandlers.delete(handler);
      };
    }
    let set = this.typedHandlers.get(type);
    if (!set) {
      set = new Set();
      this.typedHandlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  /** Subscribe to status changes. Returns an off() function. */
  onStatus(listener: (s: WsStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private setStatus(status: WsStatus): void {
    this.currentStatus = status;
    for (const l of this.statusListeners) l(status);
  }

  private send(payload: unknown): void {
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch {
      /* socket transient error — close handler will reconnect */
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts += 1;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
