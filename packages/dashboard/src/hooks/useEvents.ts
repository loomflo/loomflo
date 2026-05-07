// ============================================================================
// useEvents
//
// Loads `GET /projects/:id/events` with optional filters and appends new
// entries when the daemon broadcasts the matching WS events.
// ============================================================================

import { useEffect, useMemo } from "react";
import { useApi, useWs } from "../context/AppContext.js";
import type { Event as WorkflowEvent, EventType } from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

export interface UseEventsArgs {
  projectId: string | null | undefined;
  type?: EventType;
  nodeId?: string;
  limit?: number;
}

export interface EventsResource {
  events: WorkflowEvent[];
  total: number;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useEvents(args: UseEventsArgs): EventsResource {
  const api = useApi();
  const ws = useWs();
  const projectId = args.projectId ?? null;
  const filter = useMemo(() => {
    const f: { type?: EventType; nodeId?: string; limit?: number } = {};
    if (args.type !== undefined) f.type = args.type;
    if (args.nodeId !== undefined) f.nodeId = args.nodeId;
    if (args.limit !== undefined) f.limit = args.limit;
    return f;
  }, [args.type, args.nodeId, args.limit]);

  const res = useAsyncResource<{ events: WorkflowEvent[]; total: number }>(
    async () => {
      if (!projectId) throw new Error("No projectId");
      return api.getEvents(projectId, filter);
    },
    [api, projectId, filter.type, filter.nodeId, filter.limit],
  );

  useEffect(() => {
    if (!projectId) return;
    const off = ws.on("*", (ev) => {
      // Best-effort: refresh on any event affecting this project. The events
      // endpoint persists to disk so we re-read instead of trying to mirror
      // the WS-derived shape (the WS event payload differs from the Event
      // schema returned by /events).
      if (ev.projectId !== undefined && ev.projectId !== projectId) return;
      void res.refresh();
    });
    return off;
  }, [ws, projectId, res]);

  const events = res.data?.events ?? [];
  const total = res.data?.total ?? 0;

  return { events, total, loading: res.loading, error: res.error, refresh: res.refresh };
}
