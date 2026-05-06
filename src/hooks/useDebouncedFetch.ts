// Debounced fetch hook with cancellation safety.
//
// Wraps the common pattern in dashboards:
//
//   useEffect(() => {
//     if (debounceRef.current) clearTimeout(debounceRef.current);
//     debounceRef.current = setTimeout(async () => { ... }, 400);
//   }, [...deps]);
//
// Caller passes `fetchFn` (a closure that captures current state) and the
// dependency array that should trigger a refetch. Returns `{ data, loading }`.
//
// Notes:
// - `skipInitial` avoids the first run when the page does its own warm-up
//   load and only needs the hook for subsequent reactive refetches.
// - Stale results are dropped if a newer fetch starts before the previous
//   one resolves (uses an incrementing fetchId).

"use client";

import { useEffect, useRef, useState } from "react";

export interface UseDebouncedFetchOptions {
  ms?: number;
  skipInitial?: boolean;
}

export function useDebouncedFetch<T>(
  fetchFn: () => Promise<T>,
  deps: React.DependencyList,
  options: UseDebouncedFetchOptions = {},
): { data: T | null; loading: boolean } {
  const { ms = 400, skipInitial = false } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);
  const skippedFirstRef = useRef(false);

  useEffect(() => {
    if (skipInitial && !skippedFirstRef.current) {
      skippedFirstRef.current = true;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const myId = ++fetchIdRef.current;
      setLoading(true);
      try {
        const result = await fetchFn();
        if (myId === fetchIdRef.current) {
          setData(result);
        }
      } finally {
        if (myId === fetchIdRef.current) {
          setLoading(false);
        }
      }
    }, ms);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Cancel any pending timer on unmount and invalidate in-flight fetches.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      fetchIdRef.current++;
    };
  }, []);

  return { data, loading };
}
