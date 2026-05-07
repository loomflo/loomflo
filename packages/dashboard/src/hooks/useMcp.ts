// ============================================================================
// useMcp
//
// Per-project MCP server CRUD. Wraps GET /projects/:id/mcp + PUT/DELETE.
// ============================================================================

import { useCallback } from "react";
import { useApi } from "../context/AppContext.js";
import type { McpServerConfigEntry } from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

export interface McpResource {
  servers: Record<string, McpServerConfigEntry>;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  upsert: (name: string, entry: McpServerConfigEntry) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

export function useMcp(projectId: string | null | undefined): McpResource {
  const api = useApi();
  const res = useAsyncResource<{ servers: Record<string, McpServerConfigEntry> }>(
    async () => {
      if (!projectId) throw new Error("No projectId");
      return api.listMcp(projectId);
    },
    [api, projectId],
  );

  const upsert = useCallback(
    async (name: string, entry: McpServerConfigEntry) => {
      if (!projectId) return;
      await api.upsertMcp(projectId, name, entry);
      await res.refresh();
    },
    [api, projectId, res],
  );

  const remove = useCallback(
    async (name: string) => {
      if (!projectId) return;
      await api.deleteMcp(projectId, name);
      await res.refresh();
    },
    [api, projectId, res],
  );

  return {
    servers: res.data?.servers ?? {},
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
    upsert,
    remove,
  };
}
