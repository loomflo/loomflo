// ============================================================================
// useConfig
//
// Per-project resolved Config. Reads + partial PUT updates.
// ============================================================================

import { useCallback } from "react";
import { useApi } from "../context/AppContext.js";
import type { Config } from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

export interface ConfigResource {
  config: Config | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  update: (partial: Partial<Config>) => Promise<Config>;
}

export function useConfig(projectId: string | null | undefined): ConfigResource {
  const api = useApi();
  const res = useAsyncResource<{ config: Config }>(
    async () => {
      if (!projectId) throw new Error("No projectId");
      return api.getConfig(projectId);
    },
    [api, projectId],
  );

  const update = useCallback(
    async (partial: Partial<Config>): Promise<Config> => {
      if (!projectId) throw new Error("No projectId");
      const out = await api.updateConfig(projectId, partial);
      res.set({ config: out.config });
      return out.config;
    },
    [api, projectId, res],
  );

  return {
    config: res.data?.config ?? null,
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
    update,
  };
}
