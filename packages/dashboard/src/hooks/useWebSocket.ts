import { useEffect, useRef, useState } from "react";

import { wsUrl, type SubscribeSpec } from "../lib/ws.js";

export interface UseWebSocketOptions {
  baseUrl: string;
  token: string;
  subscribe: SubscribeSpec;
  onMessage?: (frame: Record<string, unknown>) => void;
}

export interface UseWebSocketReturn {
  connected: boolean;
  lastError: Error | null;
}

export function useWebSocket(opts: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);
  const onMessageRef = useRef(opts.onMessage);
  onMessageRef.current = opts.onMessage;

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let socket: WebSocket | null = null;

    const connect = (): void => {
      socket = new WebSocket(wsUrl(opts.baseUrl, opts.token));
      socket.onopen = (): void => {
        retry = 0;
        setConnected(true);
        socket?.send(JSON.stringify({ type: "subscribe", ...opts.subscribe }));
      };
      socket.onmessage = (e): void => {
        try {
          onMessageRef.current?.(JSON.parse(e.data as string) as Record<string, unknown>);
        } catch {
          /* ignore non-JSON frame */
        }
      };
      socket.onerror = (): void => {
        setLastError(new Error("WebSocket error"));
      };
      socket.onclose = (): void => {
        setConnected(false);
        if (closed) return;
        retry++;
        const delay = Math.min(30_000, 2 ** retry * 500);
        setTimeout(connect, delay);
      };
    };

    connect();

    return (): void => {
      closed = true;
      socket?.close();
    };
  }, [opts.baseUrl, opts.token, JSON.stringify(opts.subscribe)]);

  return { connected, lastError };
}
