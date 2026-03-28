import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentRole,
  AgentStatus,
  NodeStatus,
  ReviewVerdict,
  WorkflowStatus,
} from "../lib/types.js";

// ============================================================================
// WebSocket Event Interfaces
// ============================================================================

/** Server welcome message sent on initial connection. */
export interface ConnectedEvent {
  type: "connected";
  version: string;
}

/** Sent when a node's execution status changes. */
export interface NodeStatusEvent {
  type: "node_status";
  nodeId: string;
  status: NodeStatus;
  title: string;
  timestamp: string;
}

/** Sent when an agent's lifecycle status changes. */
export interface AgentStatusEvent {
  type: "agent_status";
  nodeId: string;
  agentId: string;
  role: AgentRole;
  status: AgentStatus;
  task: string;
  timestamp: string;
}

/** Sent when an agent sends a message to another agent via MessageBus. */
export interface AgentMessageEvent {
  type: "agent_message";
  nodeId: string;
  from: string;
  to: string;
  summary: string;
  timestamp: string;
}

/** Sent when Loomex produces a review verdict. */
export interface ReviewVerdictEvent {
  type: "review_verdict";
  nodeId: string;
  verdict: ReviewVerdict;
  summary: string;
  timestamp: string;
}

/** Actions that can modify the workflow graph. */
export type GraphModifiedAction =
  | "insert_node"
  | "remove_node"
  | "modify_node"
  | "change_delay"
  | "add_edge"
  | "remove_edge";

/** Sent when Loom modifies the workflow graph during execution. */
export interface GraphModifiedEvent {
  type: "graph_modified";
  action: GraphModifiedAction;
  details: Record<string, unknown>;
  timestamp: string;
}

/** Sent after every LLM API call completes with cost information. */
export interface CostUpdateEvent {
  type: "cost_update";
  nodeId: string;
  agentId: string;
  callCost: number;
  nodeCost: number;
  totalCost: number;
  budgetRemaining: number;
  timestamp: string;
}

/** Sent when a shared memory file is written to. */
export interface MemoryUpdatedEvent {
  type: "memory_updated";
  file: string;
  agentId: string;
  summary: string;
  timestamp: string;
}

/** Sent during Phase 1 as each spec artifact is generated. */
export interface SpecArtifactReadyEvent {
  type: "spec_artifact_ready";
  name: string;
  path: string;
  timestamp: string;
}

/** Sent when Loom responds to a user chat message. */
export interface ChatResponseEvent {
  type: "chat_response";
  message: string;
  action: string | null;
  timestamp: string;
}

/** Sent when the overall workflow status changes. */
export interface WorkflowStatusEvent {
  type: "workflow_status";
  status: WorkflowStatus;
  reason: string;
  timestamp: string;
}

/** Union of all WebSocket event types (excluding the welcome message). */
export type WsEvent =
  | NodeStatusEvent
  | AgentStatusEvent
  | AgentMessageEvent
  | ReviewVerdictEvent
  | GraphModifiedEvent
  | CostUpdateEvent
  | MemoryUpdatedEvent
  | SpecArtifactReadyEvent
  | ChatResponseEvent
  | WorkflowStatusEvent;

/** The discriminator values for subscribable event types. */
export type WsEventType = WsEvent["type"];

/** Maps an event type discriminator to its corresponding event interface. */
type WsEventMap = {
  [E in WsEvent as E["type"]]: E;
};

/** Typed callback for a specific event type. */
export type WsEventCallback<T extends WsEventType> = (
  event: WsEventMap[T],
) => void;

// ============================================================================
// Hook Options & Return Type
// ============================================================================

/** Configuration options for the useWebSocket hook. */
export interface UseWebSocketOptions {
  /** Whether to connect automatically when a token is provided. Defaults to true. */
  autoConnect?: boolean;
  /** Maximum number of reconnection attempts before giving up. Defaults to Infinity. */
  reconnectMaxRetries?: number;
}

/** Return value of the useWebSocket hook. */
export interface UseWebSocketReturn {
  /** Whether the WebSocket is currently connected. */
  connected: boolean;
  /**
   * Subscribe to a specific event type.
   *
   * @param type - The event type to listen for.
   * @param callback - Handler invoked when an event of that type arrives.
   * @returns An unsubscribe function that removes the subscription.
   */
  subscribe: <T extends WsEventType>(
    type: T,
    callback: WsEventCallback<T>,
  ) => () => void;
  /** Manually disconnect the WebSocket. Disables automatic reconnection. */
  disconnect: () => void;
  /** Manually trigger a reconnection attempt. Resets the backoff counter. */
  reconnect: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 32000;

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * React hook that manages a WebSocket connection to the Loomflo daemon.
 *
 * Connects to `ws://<host>/ws?token=<token>`, receives server-pushed events,
 * and dispatches them to typed subscribers. Implements exponential backoff
 * reconnection on disconnect.
 *
 * @param token - Authentication token. Connection is only attempted when non-null.
 * @param options - Optional configuration for auto-connect and retry behavior.
 * @returns An object with connection state, subscribe/unsubscribe, disconnect, and reconnect controls.
 */
export function useWebSocket(
  token: string | null,
  options: UseWebSocketOptions = {},
): UseWebSocketReturn {
  const { autoConnect = true, reconnectMaxRetries = Infinity } = options;

  const [connected, setConnected] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<
    Map<WsEventType, Set<WsEventCallback<WsEventType>>>
  >(new Map());
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef<boolean>(false);

  /** Clear any pending reconnection timer. */
  const clearRetryTimer = useCallback((): void => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  /** Dispatch a parsed event to all matching subscribers. */
  const dispatch = useCallback((event: WsEvent): void => {
    const callbacks = subscribersRef.current.get(event.type);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(event);
      }
    }
  }, []);

  /** Build the WebSocket URL from the current page location and token. */
  const buildUrl = useCallback(
    (tkn: string): string => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      return `${protocol}//${host}/ws?token=${encodeURIComponent(tkn)}`;
    },
    [],
  );

  /** Open a new WebSocket connection. */
  const connect = useCallback((): void => {
    if (token === null) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    intentionalCloseRef.current = false;
    clearRetryTimer();

    const ws = new WebSocket(buildUrl(token));

    ws.onopen = (): void => {
      setConnected(true);
      retryCountRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent): void => {
      try {
        const data: unknown = JSON.parse(event.data as string);
        if (
          typeof data === "object" &&
          data !== null &&
          "type" in data
        ) {
          const typed = data as { type: string };
          if (typed.type === "connected") {
            return;
          }
          dispatch(data as WsEvent);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = (): void => {
      setConnected(false);
      wsRef.current = null;

      if (intentionalCloseRef.current) return;
      if (retryCountRef.current >= reconnectMaxRetries) return;

      const delay = Math.min(
        BASE_DELAY_MS * 2 ** retryCountRef.current,
        MAX_DELAY_MS,
      );
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = (): void => {
      // The close handler will fire after error — reconnection is handled there.
    };

    wsRef.current = ws;
  }, [token, reconnectMaxRetries, clearRetryTimer, buildUrl, dispatch]);

  /** Subscribe to a specific event type with a typed callback. */
  const subscribe = useCallback(
    <T extends WsEventType>(
      type: T,
      callback: WsEventCallback<T>,
    ): (() => void) => {
      const subs = subscribersRef.current;
      if (!subs.has(type)) {
        subs.set(type, new Set());
      }
      const set = subs.get(type)!;
      const cb = callback as WsEventCallback<WsEventType>;
      set.add(cb);

      return (): void => {
        set.delete(cb);
        if (set.size === 0) {
          subs.delete(type);
        }
      };
    },
    [],
  );

  /** Disconnect the WebSocket and stop reconnection. */
  const disconnect = useCallback((): void => {
    intentionalCloseRef.current = true;
    clearRetryTimer();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, [clearRetryTimer]);

  /** Manually reconnect, resetting the backoff counter. */
  const reconnect = useCallback((): void => {
    disconnect();
    retryCountRef.current = 0;
    intentionalCloseRef.current = false;
    connect();
  }, [disconnect, connect]);

  // Auto-connect when token becomes available
  useEffect((): (() => void) => {
    if (token !== null && autoConnect) {
      connect();
    }
    return (): void => {
      intentionalCloseRef.current = true;
      clearRetryTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, autoConnect, connect, clearRetryTimer]);

  return { connected, subscribe, disconnect, reconnect };
}
