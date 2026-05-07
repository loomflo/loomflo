// ============================================================================
// useProjectsApi
//
// Daemon-level project list. Loads via REST; can subscribe to WS events to
// invalidate the list when projects come and go.
// ============================================================================

import { useEffect } from "react";
import { useApi, useWs } from "../context/AppContext.js";
import type { ProjectSummary } from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

export function useProjectsApi(): {
  projects: ProjectSummary[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const api = useApi();
  const ws = useWs();
  const res = useAsyncResource<ProjectSummary[]>(() => api.listProjects(), [api]);

  useEffect(() => {
    // No dedicated "project_added"/"project_removed" event yet — refresh on
    // graph_modified or runtime_session_started, which signal lifecycle activity.
    const off1 = ws.on("graph_modified", () => {
      void res.refresh();
    });
    const off2 = ws.on("runtime_session_started", () => {
      void res.refresh();
    });
    return () => {
      off1();
      off2();
    };
  }, [ws, res]);

  return {
    projects: res.data ?? [],
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
  };
}
