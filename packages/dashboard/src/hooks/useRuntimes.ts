// ============================================================================
// useRuntimes / useRuntimeAvailability / useRuntimeModels
//
// Daemon-level runtime catalog + CLI detection. Used by the wizard to
// drive provider/runtime selection.
// ============================================================================

import { useApi } from "../context/AppContext.js";
import type {
  AgentCliName,
  CliAvailability,
  ModelInfo,
  RuntimeListEntry,
} from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

export function useRuntimes(): {
  runtimes: RuntimeListEntry[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const api = useApi();
  const res = useAsyncResource<{ runtimes: RuntimeListEntry[] }>(
    () => api.listRuntimes(),
    [api],
  );
  return {
    runtimes: res.data?.runtimes ?? [],
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
  };
}

export function useRuntimeAvailability(): {
  clis: Partial<Record<AgentCliName, CliAvailability>>;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const api = useApi();
  const res = useAsyncResource<{ clis: Record<AgentCliName, CliAvailability> }>(
    () => api.runtimeAvailability(),
    [api],
  );
  return {
    clis: res.data?.clis ?? {},
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
  };
}

export function useRuntimeModels(name: string | null): {
  models: ModelInfo[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const api = useApi();
  const res = useAsyncResource<{ models: ModelInfo[] }>(
    async () => {
      if (!name) return { models: [] };
      return api.runtimeModels(name);
    },
    [api, name],
  );
  return {
    models: res.data?.models ?? [],
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
  };
}
