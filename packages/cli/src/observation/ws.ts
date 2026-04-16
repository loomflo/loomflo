/**
 * WebSocket subscription abstraction for the observation layer.
 *
 * Opens a WebSocket connection to the local daemon and provides a
 * callback-based API for receiving real-time events.
 *
 * @module
 */

import WebSocket from "ws";
import type { DaemonEndpoint } from "./api.js";

// ============================================================================
// Types
// ============================================================================

/** Specifies which projects to subscribe to. */
export type SubscribeSpec = { all: true } | { projectIds: string[] };

/** Handle returned by {@link openSubscription}. */
export interface Subscription {
  /** Register a callback for incoming messages. */
  onMessage(cb: (data: unknown) => void): void;
  /** Register a callback for socket close. */
  onClose(cb: () => void): void;
  /** Close the subscription and underlying WebSocket. */
  close(): void;
  /** Exposed for test access — the underlying ws socket. */
  _socket: WebSocket;
}

// ============================================================================
// openSubscription
// ============================================================================

/**
 * Open a WebSocket subscription to the daemon's event stream.
 *
 * Connects to `ws://127.0.0.1:<port>/ws?token=<token>`, waits for the
 * socket to open, sends a subscribe frame containing the spec, and
 * returns a {@link Subscription} handle.
 *
 * @param daemon - Daemon connection info (port + token).
 * @param spec - Which projects to subscribe to.
 * @returns A Subscription handle.
 */
export function openSubscription(daemon: DaemonEndpoint, spec: SubscribeSpec): Promise<Subscription> {
  return new Promise<Subscription>((resolve, reject) => {
    const url = `ws://127.0.0.1:${String(daemon.port)}/ws?token=${daemon.token}`;
    const socket = new WebSocket(url);

    const messageCallbacks: Array<(data: unknown) => void> = [];
    const closeCallbacks: Array<() => void> = [];

    socket.on("open", () => {
      // Send subscribe frame
      const frame = { type: "subscribe", ...spec };
      socket.send(JSON.stringify(frame));

      resolve({
        onMessage(cb: (data: unknown) => void): void {
          messageCallbacks.push(cb);
        },
        onClose(cb: () => void): void {
          closeCallbacks.push(cb);
        },
        close(): void {
          socket.close();
        },
        _socket: socket,
      });
    });

    socket.on("message", (raw: WebSocket.Data) => {
      let parsed: unknown;
      try {
        let text: string;
        if (typeof raw === "string") {
          text = raw;
        } else if (Buffer.isBuffer(raw)) {
          text = raw.toString("utf-8");
        } else if (Array.isArray(raw)) {
          text = Buffer.concat(raw).toString("utf-8");
        } else {
          // ArrayBuffer
          text = Buffer.from(raw).toString("utf-8");
        }
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      for (const cb of messageCallbacks) {
        cb(parsed);
      }
    });

    socket.on("close", () => {
      for (const cb of closeCallbacks) {
        cb();
      }
    });

    socket.on("error", (err: Error) => {
      reject(err);
    });
  });
}
