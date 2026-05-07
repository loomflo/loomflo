// ============================================================================
// useCredentials
//
// CRUD for daemon-level credential profiles.
// ============================================================================

import { useCallback } from "react";
import { useApi } from "../context/AppContext.js";
import type { ProviderProfilePayload, RedactedProfile } from "../lib/types.js";
import { useAsyncResource } from "./useAsyncResource.js";

export interface CredentialsResource {
  credentials: RedactedProfile[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  upsert: (name: string, body: ProviderProfilePayload) => Promise<RedactedProfile>;
  remove: (name: string) => Promise<void>;
}

export function useCredentials(): CredentialsResource {
  const api = useApi();
  const res = useAsyncResource<{ credentials: RedactedProfile[] }>(
    () => api.listCredentials(),
    [api],
  );

  const upsert = useCallback(
    async (name: string, body: ProviderProfilePayload): Promise<RedactedProfile> => {
      const out = await api.upsertCredential(name, body);
      await res.refresh();
      return out.credential;
    },
    [api, res],
  );

  const remove = useCallback(
    async (name: string): Promise<void> => {
      await api.deleteCredential(name);
      await res.refresh();
    },
    [api, res],
  );

  return {
    credentials: res.data?.credentials ?? [],
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
    upsert,
    remove,
  };
}
