"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * useTemplateModuleData — canonical "single brain" hook for the dual-view
 * template.
 *
 * Both `desktop/View.tsx` and `mobile/View.tsx` consume THIS hook. Neither
 * View ever calls Supabase / does RPC work / derives data on its own. Every
 * analysis, filter, and unit conversion belongs here. If a View needs a new
 * value that the other doesn't, you add it here first and both Views pick it
 * up automatically.
 *
 * Real dashboards replace the stub RPC call below with a real wrapper from
 * `src/lib/rpc.ts`. The shape of the returned object is the contract every
 * `use<Slug>Data` hook should follow:
 *
 *   {
 *     data: <RowShape[]>,
 *     loading: boolean,
 *     error: Error | null,
 *     filters: <Filters>,
 *     setFilters: (next: Partial<Filters>) => void,
 *   }
 *
 * Why a contract: TypeScript propagates the shape from the hook into both
 * Views, so structural drift between desktop and mobile is impossible by
 * construction. Combined with the binding sync rule in CLAUDE.md, this is
 * how the dual-view promise is enforced.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemplateModuleFilters {
  dataInicio: string | null;
  dataFim: string | null;
}

export interface TemplateModuleRow {
  date: string;
  value: number;
}

export interface UseTemplateModuleData {
  data: TemplateModuleRow[];
  loading: boolean;
  error: Error | null;
  filters: TemplateModuleFilters;
  setFilters: (next: Partial<TemplateModuleFilters>) => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS: TemplateModuleFilters = {
  dataInicio: null,
  dataFim: null,
};

export function useTemplateModuleData(): UseTemplateModuleData {
  const [filters, setFiltersState] = useState<TemplateModuleFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<TemplateModuleRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Latest fetch id — used to ignore stale resolutions when filters change
  // faster than the network responds.
  const fetchIdRef = useRef<number>(0);

  // Stable setter — merges partial updates without forcing the caller to
  // remember the full filter shape.
  const setFilters = useCallback((next: Partial<TemplateModuleFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // Memoised filter snapshot so the effect deps key on stable references.
  const appliedFilters = useMemo<TemplateModuleFilters>(
    () => ({ dataInicio: filters.dataInicio, dataFim: filters.dataFim }),
    [filters.dataInicio, filters.dataFim],
  );

  useEffect(() => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    // STUB: real dashboards replace this with their RPC wrapper, e.g.
    //   const rows = await rpcGetMyDashboardSerie(supabase, appliedFilters);
    // The contract: returns Promise<RowShape[]>, throws on error.
    const fetchPromise = Promise.resolve<TemplateModuleRow[]>([]);

    fetchPromise
      .then((rows) => {
        // Ignore stale responses (a newer fetch superseded this one).
        if (id !== fetchIdRef.current) return;
        setData(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== fetchIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [appliedFilters]);

  return { data, loading, error, filters, setFilters };
}
