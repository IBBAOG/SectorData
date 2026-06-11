"use client";

// ─── Single "brain" hook for /anp-prices (dual-view pattern) ──────────────────
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook. Neither View
// ever calls Supabase or derives metrics on its own. Filter state, RPC
// orchestration, trace visibility matrix and export plumbing all live here.
//
// Scope: weekly/monthly fuel prices from 3 stages of the Brazilian supply
// chain, surveyed by ANP:
//   • producer     — wholesale prices (refineries / importers) → anp_precos_produtores
//   • distribution — distributor → reseller (B2B)              → anp_precos_distribuicao
//   • retail       — pump prices (B2C)                          → anp_lpc
//
// All 3 sources are unified server-side by `get_anp_prices_serie` with
// product/unit/region normalization (Diesel S10→S500 fallback, GLP ×13 to
// R$/13kg, region naming).
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] / [mobile-only] with an explicit reason.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpPricesFiltros,
  rpcGetAnpPricesSerie,
  getAnpPricesExportCount,
  type AnpPricesFiltros,
  type AnpPricesSerieRow,
  type AnpPricesExportCountFilters,
} from "../../../lib/rpc";

// ─── Public types ─────────────────────────────────────────────────────────────

export type Product = "Gasoline" | "Diesel" | "Ethanol" | "Biodiesel" | "LPG";
export type Granularity = "brasil" | "regiao" | "uf" | "municipio";
export type Fonte = "producer" | "distribution" | "retail";

// ─── Constants (visual + behaviour) ───────────────────────────────────────────

/**
 * 3 fixed colours for the 3 supply-chain links. Never invent.
 *
 * 2026-06-10 official-brand re-pin: realigned to the canonical `SEGMENT_COLORS`
 * subset (the closed 12-color rotation in src/lib/plotlyDefaults.ts — see
 * .claude/skills/design-standards/references/colors.md). The off-palette
 * navy/bronze/teal trio (#1D4080 / #A16207 / #009688) is retired. Brand orange
 * (#FF5000) stays reserved for highlight only; these segments are stable
 * recurring entities so they keep canonical pins:
 *   Producer = Blue (#094DFF), Distribution = Green (#73C6A1),
 *   Retail = Light Orange (#FFAE66). All three are distinct within the chart.
 */
export const FONTE_COLORS: Record<Fonte, string> = {
  producer:     "#094DFF",   // Blue          — wholesale (SEGMENT_COLORS Producer)
  distribution: "#73C6A1",   // Green         — B2B distribution (SEGMENT_COLORS Distribution)
  retail:       "#FFAE66",   // Light Orange  — pump (SEGMENT_COLORS Retail)
};

export const FONTE_LABEL: Record<Fonte, string> = {
  producer:     "Producer",
  distribution: "Distribution",
  retail:       "Retail",
};

export const PRODUCTS: Product[] = ["Gasoline", "Diesel", "Ethanol", "Biodiesel", "LPG"];

export const GRANULARITY_LABEL: Record<Granularity, string> = {
  brasil:    "Brazil",
  regiao:    "Region",
  uf:        "State",
  municipio: "City",
};

/**
 * Trace visibility matrix: which supply-chain links exist for a given
 * (product × granularity) combination. Source of truth for the "missing link"
 * banner copy.
 */
export const TRACE_MATRIX: Record<Product, Record<Granularity, Fonte[]>> = {
  Gasoline:  { brasil: ["producer", "distribution", "retail"], regiao: ["producer", "distribution", "retail"], uf: ["distribution", "retail"], municipio: ["distribution"] },
  Diesel:    { brasil: ["producer", "distribution", "retail"], regiao: ["producer", "distribution", "retail"], uf: ["distribution", "retail"], municipio: ["distribution"] },
  Ethanol:   { brasil: ["distribution", "retail"],             regiao: ["distribution", "retail"],             uf: ["distribution", "retail"], municipio: ["distribution"] },
  Biodiesel: { brasil: ["producer"],                            regiao: ["producer"],                            uf: [],                          municipio: [] },
  LPG:       { brasil: ["producer", "distribution", "retail"], regiao: ["producer", "distribution", "retail"], uf: ["distribution", "retail"], municipio: ["distribution"] },
};

/** Returns a copy explaining which links were dropped (if any) for the current pair. */
export function missingLinksFor(product: Product, granularity: Granularity): { fonte: Fonte; reason: string }[] {
  const present = new Set(TRACE_MATRIX[product][granularity]);
  const allLinks: Fonte[] = ["producer", "distribution", "retail"];
  return allLinks
    .filter(f => !present.has(f))
    .map(f => ({ fonte: f, reason: reasonFor(f, product, granularity) }));
}

function reasonFor(fonte: Fonte, product: Product, granularity: Granularity): string {
  // Producer source
  if (fonte === "producer") {
    if (product === "Ethanol")   return "Producer data is not published for Ethanol by ANP.";
    if (granularity === "uf")    return "Producer prices are only published at Region level (no State breakdown).";
    if (granularity === "municipio") return "Producer prices are only published at Region level (no City breakdown).";
  }
  // Distribution source
  if (fonte === "distribution") {
    if (product === "Biodiesel") return "Distribution data is not published for Biodiesel.";
  }
  // Retail source
  if (fonte === "retail") {
    if (product === "Biodiesel")     return "Retail data is not published for Biodiesel.";
    if (granularity === "municipio") return "Retail prices are not surveyed at City level.";
  }
  return `${FONTE_LABEL[fonte]} data is not available for ${product} at ${GRANULARITY_LABEL[granularity]} level.`;
}

// ─── Chart helpers (exported so Views render consistently) ────────────────────

/**
 * Builds the main supply-chain comparison chart. Three traces fixed in
 * (producer → distribution → retail) order, each with the canonical brand
 * colour. When granularity selects a single location, the trace name is the
 * link label; in multi-location mode (e.g. multiple regions selected) the
 * trace name is "<Link> — <Location>".
 *
 * Distribution at sub-Brazil granularities is monthly while the other two are
 * weekly — we render distribution with `line.shape = "hv"` (step function) so
 * the periodicity gap is honest, not interpolated.
 */
export function buildChart(
  rows: AnpPricesSerieRow[],
  granularity: Granularity,
  height: number,
): { data: PlotData[]; layout: Partial<Layout>; unit: string } {
  if (!rows.length) {
    return { ...emptyPlot(height), unit: "" };
  }

  const unit = rows[0]?.unidade ?? "";

  // Group by (fonte, local).
  type Key = string;
  const byKey: Record<Key, AnpPricesSerieRow[]> = {};
  for (const r of rows) {
    const k = `${r.fonte}|||${r.local}`;
    (byKey[k] ??= []).push(r);
  }

  // Locations available per fonte (sorted for deterministic legend).
  const locaisPerFonte: Record<Fonte, string[]> = { producer: [], distribution: [], retail: [] };
  for (const r of rows) {
    if (!locaisPerFonte[r.fonte].includes(r.local)) locaisPerFonte[r.fonte].push(r.local);
  }
  (Object.keys(locaisPerFonte) as Fonte[]).forEach(f =>
    locaisPerFonte[f].sort((a, b) => a.localeCompare(b)),
  );

  const fonteOrder: Fonte[] = ["producer", "distribution", "retail"];
  const traces: PlotData[] = [];

  for (const fonte of fonteOrder) {
    const locais = locaisPerFonte[fonte];
    for (const local of locais) {
      const key = `${fonte}|||${local}`;
      const series = (byKey[key] ?? []).slice().sort((a, b) => a.data.localeCompare(b.data));
      if (!series.length) continue;
      const baseColor = FONTE_COLORS[fonte];
      const showLocal = locais.length > 1;
      const traceName = showLocal ? `${FONTE_LABEL[fonte]} — ${local}` : FONTE_LABEL[fonte];

      // Step function for monthly Distribution series (sub-Brazil granularities).
      const stepShape = fonte === "distribution" && granularity !== "brasil" ? "hv" : "linear";

      traces.push({
        type: "scatter",
        mode: "lines",
        name: traceName,
        x: series.map(d => d.data),
        y: series.map(d => d.preco),
        line: {
          width: 2,
          color: baseColor,
          shape: stepShape,
        },
        hovertemplate: `<b>${FONTE_LABEL[fonte]}</b>${showLocal ? ` — ${local}` : ""}<br>%{x}<br>%{y:.4f} ${unit}<extra></extra>`,
        legendgroup: fonte,
      } as PlotData);
    }
  }

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: unit } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
    unit,
  };
}

/** Number formatter — Brazilian locale, configurable decimals. */
export function fmtNumber(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

// ─── Year-slider helpers (consistent with /anp-lpc YEAR-over-DATE pattern) ────

function buildYearList(dataMin: string | null, dataMax: string | null): number[] {
  const yMin = dataMin ? parseInt(dataMin.slice(0, 4), 10) : new Date().getFullYear() - 5;
  const yMax = dataMax ? parseInt(dataMax.slice(0, 4), 10) : new Date().getFullYear();
  const out: number[] = [];
  for (let y = yMin; y <= yMax; y++) out.push(y);
  return out;
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseAnpPricesData {
  // Visibility / loading
  visible: boolean;
  visLoading: boolean;
  loading: boolean;
  serieLoading: boolean;

  // Universe (from get_anp_prices_filtros)
  filtros: AnpPricesFiltros;

  // Filters (state)
  product: Product;
  setProduct: (p: Product) => void;
  granularity: Granularity;
  setGranularity: (g: Granularity) => void;
  locais: string[];
  setLocais: (v: string[]) => void;
  toggleLocal: (l: string) => void;

  // Period (year slider over the YEAR range, converted to ISO at fetch time)
  allYears: number[];
  yearRange: [number, number];
  setYearRange: (v: [number, number]) => void;
  hasYears: boolean;
  periodBadge: [number, number] | null;

  // Locations available for the active granularity
  availableLocais: string[];

  // True when granularity != 'brasil' AND no location selected yet.
  // Views render an empty-state message and the hook skips the RPC.
  needsSelection: boolean;

  // Server response
  serieRows: AnpPricesSerieRow[];

  // Derivations
  fontesVisiveis: Fonte[];
  faltandoElos: { fonte: Fonte; reason: string }[];
  chart: { data: PlotData[]; layout: Partial<Layout>; unit: string };
  unit: string;

  // Export modal (Tier 2)
  exportOpen: boolean;
  setExportOpen: (v: boolean) => void;
  excelLoading: boolean;
  csvLoading: boolean;
  exportProdutos: string[];
  setExportProdutos: (v: string[]) => void;
  exportGranularidades: string[];
  setExportGranularidades: (v: string[]) => void;
  exportLocais: string[];
  setExportLocais: (v: string[]) => void;
  exportRange: [number, number];
  setExportRange: (v: [number, number]) => void;
  exportFilters: AnpPricesExportCountFilters;
  exportAvailableLocais: string[];
  openExportModal: () => void;
  estimateExportRows: () => Promise<number>;
  handleExportExcel: () => Promise<void>;
  handleExportCsv: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnpPricesData(): UseAnpPricesData {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-prices");
  const supabase = getSupabaseClient();

  // Universe
  const [filtros, setFiltros] = useState<AnpPricesFiltros>({
    produtos: [], granularidades: [], regioes: [], ufs: [], municipios: [],
    data_min: null, data_max: null,
  });

  // Loading flags
  const [loading, setLoading] = useState(true);

  // Filter state
  const [product, setProductState] = useState<Product>("Diesel");
  const [granularity, setGranularityState] = useState<Granularity>("brasil");
  const [locais, setLocais] = useState<string[]>([]);

  // Period
  const [allYears, setAllYears] = useState<number[]>([]);
  const [yearRange, setYearRange] = useState<[number, number]>([0, 0]);

  // Rows
  const [serieRows, setSerieRows] = useState<AnpPricesSerieRow[]>([]);

  // Export modal state (Tier 2)
  const [exportOpen, setExportOpen] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [exportProdutos, setExportProdutos] = useState<string[]>([]);
  const [exportGranularidades, setExportGranularidades] = useState<string[]>([]);
  const [exportLocais, setExportLocais] = useState<string[]>([]);
  const [exportRange, setExportRange] = useState<[number, number]>([0, 0]);

  // ── Initial load: filtros + first series fetch ──────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    (async () => {
      try {
        const f = await rpcGetAnpPricesFiltros(supabase);
        if (cancelled) return;
        setFiltros(f);

        const years = buildYearList(f.data_min, f.data_max);
        setAllYears(years);

        // Default: last 5 years (the window where all 3 sources coexist).
        const lastIdx = Math.max(0, years.length - 1);
        const startIdx = Math.max(0, years.length - 5);
        setYearRange([startIdx, lastIdx]);
        setExportRange([startIdx, lastIdx]);

        const yMin = years[startIdx];
        const yMax = years[lastIdx];

        // Initial fetch — Diesel, Brazil, last 5y.
        const rows = await rpcGetAnpPricesSerie(supabase, {
          produto:       "Diesel",
          granularidade: "brasil",
          dataInicio:    yMin ? `${yMin}-01-01` : null,
          dataFim:       yMax ? `${yMax}-12-31` : null,
        });
        if (!cancelled) setSerieRows(rows);
      } catch (e) {
        console.error("ANP Prices initial load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Filter setters that reset stale selections ──────────────────────────
  const setProduct = useCallback((p: Product) => {
    setProductState(p);
  }, []);

  const setGranularity = useCallback((g: Granularity) => {
    setGranularityState(prev => {
      if (prev === g) return prev;
      // Vocabularies differ across granularities — drop selection.
      setLocais([]);
      return g;
    });
  }, []);

  const toggleLocal = useCallback((l: string) => {
    setLocais(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);
  }, []);

  // Locations available for the active granularity.
  const availableLocais = useMemo<string[]>(() => {
    if (granularity === "brasil")    return [];
    if (granularity === "regiao")    return filtros.regioes;
    if (granularity === "uf")        return filtros.ufs;
    if (granularity === "municipio") return filtros.municipios;
    return [];
  }, [granularity, filtros.regioes, filtros.ufs, filtros.municipios]);

  // When the user picks a non-Brazil granularity but hasn't picked any locations
  // yet, skip the RPC entirely (otherwise we'd burn a huge query for all 27
  // states or hundreds of cities just to be thrown away by the next user click).
  // Views read this and render a "Select at least one ..." empty state.
  const needsSelection = granularity !== "brasil" && locais.length === 0;

  // ── Reactive serie refetch (debounced 400ms) ───────────────────────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch<AnpPricesSerieRow[] | null>(
    async () => {
      if (!supabase || loading) return null;
      // Bail out without hitting the network when the user is still in the
      // "pick a location" stage of a sub-Brazil granularity.
      if (needsSelection) return [];
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      // For sub-Brazil granularities, push selected locations to the server
      // to bound payload size. For "brasil" the server always returns a single
      // Brasil aggregate.
      const locaisParam =
        granularity !== "brasil" && locais.length > 0 ? locais : null;
      return rpcGetAnpPricesSerie(supabase, {
        produto:       product,
        granularidade: granularity,
        locais:        locaisParam,
        dataInicio:    yMin ? `${yMin}-01-01` : null,
        dataFim:       yMax ? `${yMax}-12-31` : null,
      });
    },
    [
      supabase, loading,
      product, granularity, locais, needsSelection,
      yearRange[0], yearRange[1], allYears,
    ],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  // Clear stale rows the instant the user crosses into "needsSelection" so the
  // empty state replaces the previous chart without a flash of stale data.
  useEffect(() => {
    if (needsSelection) setSerieRows([]);
  }, [needsSelection]);

  // ── Derivations ─────────────────────────────────────────────────────────
  const fontesVisiveis = useMemo<Fonte[]>(
    () => TRACE_MATRIX[product][granularity] ?? [],
    [product, granularity],
  );

  const faltandoElos = useMemo(
    () => missingLinksFor(product, granularity),
    [product, granularity],
  );

  const chart = useMemo(
    () => buildChart(serieRows, granularity, 360),
    [serieRows, granularity],
  );

  const unit = chart.unit;

  // ── Period badge ────────────────────────────────────────────────────────
  const hasYears = allYears.length > 0;
  const periodBadge: [number, number] | null =
    hasYears ? [allYears[yearRange[0]], allYears[yearRange[1]]] : null;

  // ── Export helpers ──────────────────────────────────────────────────────
  const openExportModal = useCallback(() => {
    setExportProdutos([product]);
    setExportGranularidades([granularity]);
    setExportLocais([]);
    setExportRange(yearRange);
    setExportOpen(true);
  }, [product, granularity, yearRange]);

  const exportFilters = useMemo<AnpPricesExportCountFilters>(() => {
    const yMinExp = allYears[exportRange[0]] ?? null;
    const yMaxExp = allYears[exportRange[1]] ?? null;
    return {
      produtos:        exportProdutos.length === 0 ? null : exportProdutos,
      granularidades:  exportGranularidades.length === 0 ? null : exportGranularidades,
      locais:          exportLocais.length === 0 ? null : exportLocais,
      dataInicio:      yMinExp ? `${yMinExp}-01-01` : null,
      dataFim:         yMaxExp ? `${yMaxExp}-12-31` : null,
    };
  }, [exportProdutos, exportGranularidades, exportLocais, exportRange, allYears]);

  // Locations available for the export modal — union of selected granularities.
  const exportAvailableLocais = useMemo<string[]>(() => {
    const wantsRegiao    = exportGranularidades.includes("regiao");
    const wantsUf        = exportGranularidades.includes("uf");
    const wantsMunicipio = exportGranularidades.includes("municipio");
    const list: string[] = [];
    if (wantsRegiao)    list.push(...filtros.regioes);
    if (wantsUf)        list.push(...filtros.ufs);
    if (wantsMunicipio) list.push(...filtros.municipios);
    return Array.from(new Set(list));
  }, [exportGranularidades, filtros.regioes, filtros.ufs, filtros.municipios]);

  const estimateExportRows = useCallback(async (): Promise<number> => {
    if (!supabase) return 0;
    try {
      return await getAnpPricesExportCount(supabase, exportFilters);
    } catch (e) {
      console.error("anp-prices export count failed", e);
      return 0;
    }
  }, [supabase, exportFilters]);

  /**
   * Fetches rows for every (produto × granularidade) pair selected in the
   * export modal, then returns the concatenated set. The export modal lets
   * the user widen the scope of the download beyond the current chart.
   */
  async function fetchExportRows(): Promise<AnpPricesSerieRow[]> {
    if (!supabase) return [];
    const produtos = exportProdutos.length === 0 ? PRODUCTS : (exportProdutos as Product[]);
    const grans = exportGranularidades.length === 0
      ? (filtros.granularidades as Granularity[])
      : (exportGranularidades as Granularity[]);
    const all: AnpPricesSerieRow[] = [];
    for (const p of produtos) {
      for (const g of grans) {
        const rows = await rpcGetAnpPricesSerie(supabase, {
          produto:       p,
          granularidade: g,
          locais:        exportLocais.length ? exportLocais : null,
          dataInicio:    exportFilters.dataInicio,
          dataFim:       exportFilters.dataFim,
        });
        // Tag rows with their source product so multi-product exports keep
        // context (the row itself doesn't carry the product label since the
        // RPC normalises by product input).
        for (const r of rows) {
          all.push({ ...r, ...(p && { produto: p }) } as AnpPricesSerieRow & { produto: string });
        }
      }
    }
    return all;
  }

  function nowDdMmYy(): string {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getFullYear()).slice(-2)}`;
  }

  const handleExportExcel = useCallback(async () => {
    if (!supabase) return;
    setExcelLoading(true);
    try {
      const rows = await fetchExportRows();
      const productLabel = exportProdutos.length === 1 ? exportProdutos[0] : "all-products";
      const granLabel    = exportGranularidades.length === 1 ? exportGranularidades[0] : "all-granularities";
      await downloadGenericExcel<AnpPricesSerieRow & { produto?: string }>({
        rows: rows as Array<AnpPricesSerieRow & { produto?: string }>,
        filename: `anp-prices_${productLabel}_${granLabel}_${nowDdMmYy()}`,
        title:    "ANP Prices — Producer, Distribution and Retail",
        sheetName: "ANP Prices",
        columns: [
          { key: "data",     header: "Date",        width: 14 },
          ...(exportProdutos.length !== 1
            ? [{ key: "produto" as const, header: "Product", width: 14, align: "left" as const }]
            : []),
          { key: "fonte",    header: "Source",      width: 14, align: "left" },
          { key: "local",    header: "Location",    width: 24, align: "left" },
          { key: "preco",    header: "Price",       width: 14, format: "0.0000" },
          { key: "unidade",  header: "Unit",        width: 12, align: "left" },
        ],
      });
      setExportOpen(false);
    } catch (e) {
      console.error("ANP Prices Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, exportFilters, exportProdutos, exportGranularidades, exportLocais]);

  const handleExportCsv = useCallback(async () => {
    if (!supabase) return;
    setCsvLoading(true);
    try {
      const rows = await fetchExportRows();
      const productLabel = exportProdutos.length === 1 ? exportProdutos[0] : "all-products";
      const granLabel    = exportGranularidades.length === 1 ? exportGranularidades[0] : "all-granularities";
      downloadCsv({
        rows: rows as unknown as Record<string, unknown>[],
        filename: `anp-prices_${productLabel}_${granLabel}_${nowDdMmYy()}`,
      });
      setExportOpen(false);
    } catch (e) {
      console.error("ANP Prices CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, exportFilters, exportProdutos, exportGranularidades, exportLocais]);

  return {
    visible,
    visLoading,
    loading,
    serieLoading,

    filtros,

    product,
    setProduct,
    granularity,
    setGranularity,
    locais,
    setLocais,
    toggleLocal,

    allYears,
    yearRange,
    setYearRange,
    hasYears,
    periodBadge,

    availableLocais,
    needsSelection,

    serieRows,

    fontesVisiveis,
    faltandoElos,
    chart,
    unit,

    exportOpen,
    setExportOpen,
    excelLoading,
    csvLoading,
    exportProdutos,
    setExportProdutos,
    exportGranularidades,
    setExportGranularidades,
    exportLocais,
    setExportLocais,
    exportRange,
    setExportRange,
    exportFilters,
    exportAvailableLocais,
    openExportModal,
    estimateExportRows,
    handleExportExcel,
    handleExportCsv,
  };
}
