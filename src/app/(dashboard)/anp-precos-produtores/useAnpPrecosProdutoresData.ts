"use client";

/**
 * useAnpPrecosProdutoresData — single brain for /anp-precos-produtores.
 *
 * Both desktop/View.tsx and mobile/View.tsx consume this hook.
 * Neither View calls Supabase / rpc.ts directly.
 *
 * Principles enforced here:
 *   - selectedRegioes.length === 0 is prohibited (always ≥1).
 *   - Period slider is set once at mount from filtros.data_min/max; never reset.
 *   - Refetch is debounced 400ms on produto or period change.
 *   - Region filtering is client-side via useMemo (no refetch).
 *   - All RPCs go through rpc.ts wrappers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlotData } from "plotly.js";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import {
  rpcGetAnpPprodutoresSerie,
  rpcGetAnpPprodutoresFiltros,
  type AnpPprodutoresRow,
  type AnpPprodutoresFiltros,
} from "../../../lib/rpc";

// ─── Constants ────────────────────────────────────────────────────────────────

export const REGIAO_COLOR: Record<string, string> = {
  "Norte":        "#009688",
  "Nordeste":     "#FF5722",
  "Centro-Oeste": "#9C27B0",
  "Sul":          "#3F51B5",
  "Sudeste":      "#F44336",
};

/** Canonical region order — exactly as in the DB. */
export const ALL_REGIOES = Object.keys(REGIAO_COLOR);

// ─── Types ────────────────────────────────────────────────────────────────────

export type { AnpPprodutoresRow, AnpPprodutoresFiltros };

export interface AnpPrecosProdutoresDerivedRegiao {
  regiao: string;
  color: string;
  latestPreco: number | null;
  /** Last data_inicio seen in serieRows for this region. */
  latestDate: string | null;
}

export interface UseAnpPrecosProdutoresData {
  // Raw
  filtros: AnpPprodutoresFiltros;
  serieRows: AnpPprodutoresRow[];

  // Loading flags
  loading: boolean;            // barrel — initial load
  serieLoading: boolean;       // inline — subsequent refetches

  // Filter state
  selectedProduto: string;
  selectedRegioes: string[];
  allYears: number[];
  yearRange: [number, number];

  // Setters
  setProduto: (p: string) => void;
  setRegioes: (r: string[]) => void;
  toggleRegiao: (r: string) => void;
  setYearRange: (r: [number, number]) => void;

  // Derived
  /** serieRows filtered to selectedRegioes only (client-side). */
  filteredRows: AnpPprodutoresRow[];
  /** Per-region latest price + date — for MobileDataCard ranking. */
  regionStats: AnpPrecosProdutoresDerivedRegiao[];
  /** Unidade from data (e.g. "L"). */
  unidade: string;
  /** Plotly traces + layout for the multi-region line chart. */
  chart: { data: PlotData[]; layout: Partial<import("plotly.js").Layout> };

  // Export helpers
  supabase: ReturnType<typeof getSupabaseClient>;
}

// ─── Chart builder ────────────────────────────────────────────────────────────

export function buildChart(
  rows: AnpPprodutoresRow[],
  regioes: string[],
): { data: PlotData[]; layout: Partial<import("plotly.js").Layout> } {
  const filtered = rows.filter((r) => regioes.includes(r.regiao));
  if (!filtered.length) return emptyPlot(360);

  const byRegiao: Record<string, AnpPprodutoresRow[]> = {};
  for (const r of filtered) (byRegiao[r.regiao] ??= []).push(r);

  const unidade = rows[0]?.unidade ?? "";

  const traces: PlotData[] = regioes
    .filter((r) => byRegiao[r])
    .map((r) => {
      const data = byRegiao[r].sort((a, b) =>
        a.data_inicio.localeCompare(b.data_inicio),
      );
      return {
        type: "scatter",
        mode: "lines",
        name: r,
        x: data.map((d) => d.data_inicio),
        y: data.map((d) => d.preco),
        line: { width: 2, color: REGIAO_COLOR[r] ?? "#999" },
        hovertemplate: `${r}: R$ %{y:.4f}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 360,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `R$ / ${unidade || "L"}` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: {
        orientation: "h",
        yanchor: "bottom",
        y: 1.01,
        xanchor: "left",
        x: 0,
      },
    },
  };
}

/** Build a minimal Plotly trace set for the mobile chart (single view). */
export function buildMobileChart(
  rows: AnpPprodutoresRow[],
  regioes: string[],
): PlotData[] {
  const filtered = rows.filter((r) => regioes.includes(r.regiao));
  if (!filtered.length) return [];

  const byRegiao: Record<string, AnpPprodutoresRow[]> = {};
  for (const r of filtered) (byRegiao[r.regiao] ??= []).push(r);

  return regioes
    .filter((r) => byRegiao[r])
    .map((r) => {
      const data = byRegiao[r].sort((a, b) =>
        a.data_inicio.localeCompare(b.data_inicio),
      );
      return {
        type: "scatter",
        mode: "lines",
        name: r,
        x: data.map((d) => d.data_inicio),
        y: data.map((d) => d.preco),
        line: { width: 2, color: REGIAO_COLOR[r] ?? "#999" },
        hovertemplate: `${r}: R$ %{y:.4f}<extra></extra>`,
      } as PlotData;
    });
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAnpPrecosProdutoresData(): UseAnpPrecosProdutoresData {
  const supabase = getSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState<AnpPprodutoresFiltros>({
    produtos: [],
    regioes: [],
    data_min: null,
    data_max: null,
  });
  const [serieRows, setSerieRows] = useState<AnpPprodutoresRow[]>([]);
  const [allYears, setAllYears] = useState<number[]>([]);
  const [yearRange, setYearRange] = useState<[number, number]>([0, 0]);
  const [selectedProduto, setProduto] = useState<string>("");
  const [selectedRegioes, setRegioes] = useState<string[]>(ALL_REGIOES);
  const [serieLoading, setSerieLoading] = useState(false);

  // Debounce state for reactive refetch
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);
  const initialLoadDone = useRef(false);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpPprodutoresFiltros(supabase);
      if (cancelled) return;

      setFiltros(f);

      const yMin = f.data_min
        ? parseInt(f.data_min.slice(0, 4))
        : new Date().getFullYear() - 10;
      const yMax = f.data_max
        ? parseInt(f.data_max.slice(0, 4))
        : new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex((y) => y >= yMax - 9));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      const defaultProduto = f.produtos.includes("Gasolina A Comum")
        ? "Gasolina A Comum"
        : f.produtos[0] ?? "";
      setProduto(defaultProduto);

      if (defaultProduto) {
        const rows = await rpcGetAnpPprodutoresSerie(supabase, {
          produto: defaultProduto,
          dataInicio: `${fromYear}-01-01`,
          dataFim: `${yMax}-12-31`,
        });
        if (!cancelled) setSerieRows(rows);
      }

      initialLoadDone.current = true;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // supabase is stable — intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reactive refetch (debounced 400ms) ────────────────────────────────────
  useEffect(() => {
    if (!supabase || !initialLoadDone.current || !selectedProduto) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const id = ++fetchIdRef.current;
      setSerieLoading(true);
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      try {
        const rows = await rpcGetAnpPprodutoresSerie(supabase, {
          produto: selectedProduto,
          dataInicio: yMin ? `${yMin}-01-01` : null,
          dataFim: yMax ? `${yMax}-12-31` : null,
        });
        if (id !== fetchIdRef.current) return;
        setSerieRows(rows);
      } catch (e) {
        console.error("get_anp_precos_produtores_serie refetch failed", e);
      } finally {
        if (id === fetchIdRef.current) setSerieLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduto, yearRange[0], yearRange[1]]);

  // ── toggleRegiao — preserves min-1 invariant ──────────────────────────────
  const toggleRegiao = useCallback((r: string) => {
    setRegioes((prev) =>
      prev.includes(r)
        ? prev.length > 1
          ? prev.filter((x) => x !== r)
          : prev // can't remove last one
        : [...prev, r],
    );
  }, []);

  // ── Derived: filtered rows (client-side region filter) ────────────────────
  const filteredRows = useMemo(
    () => serieRows.filter((r) => selectedRegioes.includes(r.regiao)),
    [serieRows, selectedRegioes],
  );

  // ── Derived: per-region stats for MobileDataCard ranking ─────────────────
  const regionStats = useMemo<AnpPrecosProdutoresDerivedRegiao[]>(() => {
    const map: Record<string, { preco: number | null; date: string | null }> = {};
    for (const row of serieRows) {
      const cur = map[row.regiao];
      if (!cur || row.data_inicio > (cur.date ?? "")) {
        map[row.regiao] = { preco: row.preco, date: row.data_inicio };
      }
    }
    return ALL_REGIOES.map((r) => ({
      regiao: r,
      color: REGIAO_COLOR[r] ?? "#999",
      latestPreco: map[r]?.preco ?? null,
      latestDate: map[r]?.date ?? null,
    })).sort((a, b) => (b.latestPreco ?? 0) - (a.latestPreco ?? 0));
  }, [serieRows]);

  // ── Derived: unidade ──────────────────────────────────────────────────────
  const unidade = serieRows[0]?.unidade ?? "L";

  // ── Derived: chart ────────────────────────────────────────────────────────
  const chart = useMemo(
    () => buildChart(serieRows, selectedRegioes),
    [serieRows, selectedRegioes],
  );

  return {
    filtros,
    serieRows,
    loading,
    serieLoading,
    selectedProduto,
    selectedRegioes,
    allYears,
    yearRange,
    setProduto,
    setRegioes,
    toggleRegiao,
    setYearRange,
    filteredRows,
    regionStats,
    unidade,
    chart,
    supabase,
  };
}
