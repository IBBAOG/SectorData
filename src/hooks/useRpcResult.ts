// useRpcResult — fetch-with-explicit-error hook for Supabase RPC consumption.
//
// Replaces the historical anti-pattern across ~17 dashboards:
//
//   try {
//     const r = await rpcGetX();
//     setData(r ?? []);
//   } catch (e) {
//     console.warn(e);
//     setData([]);          // ← bug went undetected for months in prod
//   }
//
// With this hook you keep `data: fallback` (so the UI does not crash), but you
// also expose `error` so the caller can surface it via `<DataErrorBoundary>`
// instead of swallowing the failure silently.
//
//   const { data, loading, error, refetch } = useRpcResult<Row[]>(
//     () => rpcGetSerie(period),
//     [period],
//     [],          // fallback: empty array
//   );
//
//   return (
//     <DataErrorBoundary error={error} loading={loading} retry={refetch}>
//       <Chart data={data} />
//     </DataErrorBoundary>
//   );
//
// Notes:
//   - Stale-result protection via incrementing fetchId (mirrors useDebouncedFetch).
//   - `refetch` re-runs the same closure; useful for the "Tentar novamente" button.
//   - In development the hook logs failures with the `[useRpcResult]` prefix so
//     they show up immediately in DevTools, even when the UI is recovered to
//     `data = fallback` for the empty-card branch.
//   - This hook does NOT debounce. If you need debounce, compose it with
//     `useDebouncedFetch` for the input-driven path and use `useRpcResult` only
//     for the warm-up / one-shot fetches. (Future: extract a combined helper.)
//
// Owned by: worker_subgerente-app.

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from "react";

export interface UseRpcResult<T> {
  data: T;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

const isDev =
  typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

export function useRpcResult<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  fallback: T,
): UseRpcResult<T> {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // We keep the latest fetcher in a ref so `refetch` is stable, but the
  // effect below still re-runs when `deps` change (intentional).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetchIdRef = useRef(0);
  const mountedRef = useRef(true);

  const run = useCallback(() => {
    const myId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((result) => {
        if (myId !== fetchIdRef.current || !mountedRef.current) return;
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (myId !== fetchIdRef.current || !mountedRef.current) return;
        const err = e instanceof Error ? e : new Error(String(e));
        if (isDev) {
          console.error("[useRpcResult] RPC failed:", err);
        }
        setError(err);
        // Keep `data` at its current value (or fallback on first load) so
        // the chart doesn't blink to empty between failed retries.
      })
      .finally(() => {
        if (myId !== fetchIdRef.current || !mountedRef.current) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Mount/unmount tracker — drops late results after navigation.
  useEffect(() => {
    mountedRef.current = true;
    const fetchIdRefSnapshot = fetchIdRef;
    return () => {
      mountedRef.current = false;
      fetchIdRefSnapshot.current++;
    };
  }, []);

  return { data, loading, error, refetch: run };
}
