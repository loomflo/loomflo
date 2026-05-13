// ============================================================================
// useEvents
//
// Loads `GET /projects/:id/events` with optional filters and appends new
// entries when the daemon broadcasts the matching WS events.
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import { useApi, useWs } from "../context/AppContext.js";
import type { Event as WorkflowEvent, EventType } from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

const REFRESH_DEBOUNCE_MS = 250;

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

  const { data, loading, error, refresh } = useAsyncResource<{
    events: WorkflowEvent[];
    total: number;
  }>(
    async () => {
      if (!projectId) throw new Error("No projectId");
      return api.getEvents(projectId, filter);
    },
    [api, projectId, filter.type, filter.nodeId, filter.limit],
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) return;
    // Coalesce bursty WS events (every node/agent/cost update) into one fetch.
    // The /events endpoint persists to disk; the WS payload doesn't match the
    // Event schema, so we re-read rather than mirroring locally.
    const scheduleRefresh = (): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void refresh();
      }, REFRESH_DEBOUNCE_MS);
    };
    const off = ws.on("*", (ev) => {
      if (ev.projectId !== undefined && ev.projectId !== projectId) return;
      scheduleRefresh();
    });
    return () => {
      off();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [ws, projectId, refresh]);

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  return { events, total, loading, error, refresh };
}
