// ============================================================================
// useAsyncResource
//
// Tiny REST-fetch helper used by every hook in this folder. Tracks the
// usual loading/error/data triple, exposes a manual refresh() and an
// `active` guard so we never call setState on an unmounted component.
//
// Not a generic data-fetching library — kept minimal because Phase C will
// likely replace it with TanStack Query or SWR.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Re-run the fetcher with the latest closure. */
  refresh: () => Promise<void>;
  /** Manual setter, used by WS handlers to patch the cached value. */
  set: (updater: T | ((prev: T | null) => T | null)) => void;
}

export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const activeRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const value = await fetcherRef.current();
      if (!activeRef.current) return;
      setData(value);
    } catch (err) {
      if (!activeRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    void run();
    return () => {
      activeRef.current = false;
    };
  }, deps);

  const refresh = useCallback(async () => {
    await run();
  }, [run]);

  const set = useCallback(
    (updater: T | ((prev: T | null) => T | null)) => {
      setData((prev) =>
        typeof updater === "function" ? (updater as (p: T | null) => T | null)(prev) : updater,
      );
    },
    [],
  );

  return { data, loading, error, refresh, set };
}
