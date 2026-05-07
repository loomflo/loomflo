// ============================================================================
// useNode
//
// Loads detailed node info and patches it from WS streams (node_status,
// agent_status, cost_update, runtime_session_event, mcp_tool_called).
// ============================================================================

import { useEffect, useState } from "react";
import { useApi, useWs } from "../context/AppContext.js";
import type {
  AgentInfo,
  Node,
  WsMcpToolCalledEvent,
  WsRuntimeSessionEvent,
  WsRuntimeSessionStartedEvent,
} from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

/**
 * Live signals derived from the WS stream that pages may want to surface
 * even when they don't own the entire Node state.
 */
export interface NodeLiveSignals {
  /** Latest runtime session event payloads (last 200, in order). */
  sessionEvents: WsRuntimeSessionEvent[];
  /** Latest MCP tool calls (last 100). */
  mcpCalls: WsMcpToolCalledEvent[];
  /** Latest "session started" announcements (max 5 — usually one per agent). */
  sessions: WsRuntimeSessionStartedEvent[];
}

const SESSION_EVENT_LIMIT = 200;
const MCP_CALL_LIMIT = 100;
const SESSION_LIMIT = 5;

export interface NodeResource {
  node: Node | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  live: NodeLiveSignals;
}

export function useNode(
  projectId: string | null | undefined,
  nodeId: string | null | undefined,
): NodeResource {
  const api = useApi();
  const ws = useWs();

  const res = useAsyncResource<Node>(
    async () => {
      if (!projectId || !nodeId) throw new Error("Missing projectId/nodeId");
      return api.getNode(projectId, nodeId);
    },
    [api, projectId, nodeId],
  );

  const [sessionEvents, setSessionEvents] = useState<WsRuntimeSessionEvent[]>([]);
  const [mcpCalls, setMcpCalls] = useState<WsMcpToolCalledEvent[]>([]);
  const [sessions, setSessions] = useState<WsRuntimeSessionStartedEvent[]>([]);

  useEffect(() => {
    setSessionEvents([]);
    setMcpCalls([]);
    setSessions([]);
  }, [projectId, nodeId]);

  useEffect(() => {
    if (!projectId || !nodeId) return;

    const matches = (eventProjectId: string | undefined, eventNodeId: string): boolean =>
      (eventProjectId === undefined || eventProjectId === projectId) && eventNodeId === nodeId;

    const off1 = ws.on("node_status", (ev) => {
      if (!matches(ev.projectId, ev.nodeId)) return;
      res.set((prev) => (prev ? { ...prev, status: ev.status } : prev));
    });
    const off2 = ws.on("agent_status", (ev) => {
      if (!matches(ev.projectId, ev.nodeId)) return;
      res.set((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          agents: prev.agents.map(
            (a): AgentInfo => (a.id === ev.agentId ? { ...a, status: ev.status } : a),
          ),
        };
      });
    });
    const off3 = ws.on("cost_update", (ev) => {
      if (!matches(ev.projectId, ev.nodeId)) return;
      res.set((prev) => (prev ? { ...prev, cost: ev.nodeCost } : prev));
    });
    const off4 = ws.on("runtime_session_started", (ev) => {
      if (!matches(ev.projectId, ev.nodeId)) return;
      setSessions((list) => [...list.slice(-(SESSION_LIMIT - 1)), ev]);
    });
    const off5 = ws.on("runtime_session_event", (ev) => {
      if (!matches(ev.projectId, ev.nodeId)) return;
      setSessionEvents((list) => [...list.slice(-(SESSION_EVENT_LIMIT - 1)), ev]);
    });
    const off6 = ws.on("mcp_tool_called", (ev) => {
      if (!matches(ev.projectId, ev.nodeId)) return;
      setMcpCalls((list) => [...list.slice(-(MCP_CALL_LIMIT - 1)), ev]);
    });

    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
      off6();
    };
  }, [ws, projectId, nodeId, res]);

  return {
    node: res.data,
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
    live: { sessionEvents, mcpCalls, sessions },
  };
}
