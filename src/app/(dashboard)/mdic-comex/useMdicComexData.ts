"use client";

// Single "brain" hook for /mdic-comex (dual-view pattern).
// Both desktop/View.tsx and mobile/View.tsx consume this hook.
// No View ever calls Supabase or derives metrics on its own.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedFetch } from "@/hooks/useDebouncedFetch";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetMdicComexAggregated,
  rpcGetMdicComexFiltros,
  getMdicComexExportCount,
  fetchMdicComexRawFiltered,
  type MdicComexAggregatedRow,
  type MdicComexAggregatedFilters,
  type MdicComexGroupBy,
} from "@/lib/rpc";
import {
  downloadMdicComexRawExcel,
  downloadMdicComexAggregatedExcel,
} from "@/lib/exportExcel";
import { downloadCsv } from "@/lib/exportCsv";

// ── Constants ──────────────────────────────────────────────────────────────────

export const M3_TO_BBL = 6.28981; // industry standard: 1 m³ = 6.28981 bbl

export const NCM_DENSITY_KG_PER_M3: Record<string, number> = {
  "27090010": 870, // crude oil
  "27101259": 745, // gasoline
  "27101921": 832, // diesel
};

/** Derive volume in m³ from net weight using standard ANP densities. */
export function volumeM3(r: { volume_kg?: number | null; ncm_codigo?: string | null }): number | null {
  if (!r.volume_kg || r.volume_kg <= 0) return null;
  const density = r.ncm_codigo ? NCM_DENSITY_KG_PER_M3[r.ncm_codigo] : undefined;
  if (!density) return null;
  return r.volume_kg / density;
}

export const NCM_INFO: Record<string, { label: string; color: string }> = {
  "27090010": { label: "Crude Oil", color: "#1a1a1a" },
  "27101259": { label: "Gasoline",  color: "#FF5000" },
  "27101921": { label: "Diesel",    color: "#2196F3" },
};
export const ALL_NCMS = Object.keys(NCM_INFO);

// Threshold for Individual mode advisory warning
export const INDIVIDUAL_WARN_THRESHOLD = 20;

// ── Metric toggle ──────────────────────────────────────────────────────────────

export type Metric = "volume" | "volume_m3" | "fob" | "fob_per_ton" | "fob_per_m3" | "fob_per_bbl";

export const METRIC_OPTIONS: Array<{ value: Metric; label: string }> = [
  { value: "volume",      label: "Volume (kt)" },
  { value: "volume_m3",   label: "Volume (k m³)" },
  { value: "fob",         label: "FOB (USD M)" },
  { value: "fob_per_ton", label: "FOB / ton" },
  { value: "fob_per_m3",  label: "FOB / m³" },
  { value: "fob_per_bbl", label: "FOB / bbl" },
];

export type MetricRow = {
  volume_kg:     number | null;
  valor_fob_usd: number | null;
  ncm_codigo?:   string | null;
};

export const METRIC_CONFIG: Record<Metric, {
  axisTitle:   () => string;
  hoverUnit:   () => string;
  tableHeader: () => string;
  select:      (r: MetricRow) => number | null;
}> = {
  volume:      {
    axisTitle:   () => "kt",
    hoverUnit:   () => "kt",
    tableHeader: () => "kt",
    select:      r => (r.volume_kg ?? 0) / 1e6,
  },
  volume_m3:   {
    axisTitle:   () => "k m³",
    hoverUnit:   () => "k m³",
    tableHeader: () => "k m³",
    select:      r => { const v = volumeM3(r); return v != null ? v / 1000 : null; },
  },
  fob:         {
    axisTitle:   () => "USD M",
    hoverUnit:   () => "USD M",
    tableHeader: () => "USD M",
    select:      r => (r.valor_fob_usd ?? 0) / 1e6,
  },
  fob_per_ton: {
    axisTitle:   () => "USD/ton",
    hoverUnit:   () => "USD/ton",
    tableHeader: () => "USD/ton",
    select:      r =>
      (r.volume_kg && r.volume_kg > 0 && r.valor_fob_usd != null)
        ? r.valor_fob_usd / (r.volume_kg / 1000)
        : null,
  },
  fob_per_m3:  {
    axisTitle:   () => "USD/m³",
    hoverUnit:   () => "USD/m³",
    tableHeader: () => "USD/m³",
    select:      r => { const v = volumeM3(r); return (v && v > 0 && r.valor_fob_usd != null) ? r.valor_fob_usd / v : null; },
  },
  fob_per_bbl: {
    axisTitle:   () => "USD/bbl",
    hoverUnit:   () => "USD/bbl",
    tableHeader: () => "USD/bbl",
    select:      r => { const v = volumeM3(r); return (v && v > 0 && r.valor_fob_usd != null) ? r.valor_fob_usd / (v * M3_TO_BBL) : null; },
  },
};

// ── View mode ──────────────────────────────────────────────────────────────────

export type ViewMode = "consolidated" | "individual";
export const VIEW_MODE_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "consolidated", label: "Consolidated" },
  { value: "individual",   label: "Individual" },
];

// ── Export constants ───────────────────────────────────────────────────────────

export const RAW_EXCEL_MAX_ROWS = 200_000;
export const RAW_ABS_MAX_ROWS   = 500_000;

export type MdicComexGranularity = "raw" | "ncm" | "pais" | "flow" | "ano_mes";

export const MDIC_GROUPBY_MAP: Record<Exclude<MdicComexGranularity, "raw">, MdicComexGroupBy[]> = {
  ncm:     ["ano", "mes", "ncm_codigo", "ncm_nome"],
  pais:    ["ano", "mes", "pais"],
  flow:    ["ano", "mes", "flow"],
  ano_mes: ["ano", "mes"],
};

export const MDIC_GRANULARITY_OPTIONS: Array<{
  value: MdicComexGranularity;
  label: string;
  hint:  string;
}> = [
  { value: "raw",     label: "Raw rows (all dimensions)",   hint: "1 row per (year, month, flow, NCM, country)" },
  { value: "ncm",     label: "By NCM",                      hint: "sum by (year, month, NCM)" },
  { value: "pais",    label: "By country",                  hint: "sum by (year, month, country)" },
  { value: "flow",    label: "By flow (IMP/EXP)",           hint: "sum by (year, month, flow)" },
  { value: "ano_mes", label: "By year/month (total)",       hint: "total sum by month (≤252 rows)" },
];

export const MDIC_AGG_ESTIMATE: Record<Exclude<MdicComexGranularity, "raw">, number> = {
  ano_mes: 252,
  flow:    252 * 2,
  ncm:     252 * 3,
  pais:    252 * 60,
};

// ── Table row type ─────────────────────────────────────────────────────────────

export type TableRow = {
  label:   string;
  imp:     number | null;
  exp:     number | null;
  impMoM:  number | null;
  expMoM:  number | null;
  impYoY:  number | null;
  expYoY:  number | null;
};

export function formatPct(v: number | null): { text: string; color: string } {
  if (v === null || !isFinite(v)) return { text: "—", color: "#888" };
  const sign = v >= 0 ? "+" : "";
  return {
    text:  `${sign}${v.toFixed(1)}%`,
    color: v >= 0 ? "#1b7a3e" : "#b71c1c",
  };
}

export function buildTableRows(
  rows: MdicComexAggregatedRow[],
  metric: Metric,
): TableRow[] {
  const byMonth: Record<string, { imp: number | null; exp: number | null }> = {};
  for (const r of rows) {
    if (r.ano == null || r.mes == null) continue;
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { imp: null, exp: null };
    const v = METRIC_CONFIG[metric].select(r);
    if (r.flow === "import") byMonth[key].imp = (byMonth[key].imp ?? 0) + (v ?? 0);
    if (r.flow === "export") byMonth[key].exp = (byMonth[key].exp ?? 0) + (v ?? 0);
  }

  const allKeys = Object.keys(byMonth).sort().reverse();
  if (allKeys.length < 2) return [];

  const displayKeys = allKeys.slice(0, 24);

  return displayKeys.map(key => {
    const { imp, exp } = byMonth[key];

    const prevIdx  = allKeys.indexOf(key) + 1;
    const prevKey  = allKeys[prevIdx] ?? null;
    const prevImp  = prevKey ? (byMonth[prevKey]?.imp ?? null) : null;
    const prevExp  = prevKey ? (byMonth[prevKey]?.exp ?? null) : null;

    const yoyIdx   = allKeys.indexOf(key) + 12;
    const yoyKey   = allKeys[yoyIdx] ?? null;
    const yoyImp   = yoyKey ? (byMonth[yoyKey]?.imp ?? null) : null;
    const yoyExp   = yoyKey ? (byMonth[yoyKey]?.exp ?? null) : null;

    function pct(curr: number | null, base: number | null): number | null {
      if (curr == null || base == null || base === 0) return null;
      return (curr / base - 1) * 100;
    }

    return {
      label:  key,
      imp,
      exp,
      impMoM: pct(imp, prevImp),
      expMoM: pct(exp, prevExp),
      impYoY: pct(imp, yoyImp),
      expYoY: pct(exp, yoyExp),
    };
  });
}

// ── Hook return type ───────────────────────────────────────────────────────────

export interface UseMdicComexData {
  // Loading / visibility
  loading: boolean;
  visLoading: boolean;
  visible: boolean;

  // Filter state
  anos: number[];
  allPaises: string[];
  yearRange: [number, number];
  setYearRange: (v: [number, number]) => void;
  selectedNCMs: string[];
  toggleNcm: (ncm: string) => void;
  resetNcms: () => void;
  selectedPaises: string[];
  setSelectedPaises: (v: string[]) => void;
  metric: Metric;
  setMetric: (v: Metric) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  showIndividualWarn: boolean;
  setShowIndividualWarn: (v: boolean) => void;

  // Derived
  hasYears: boolean;
  yMin: number | null;
  yMax: number | null;
  paisesFilter: string[] | null;

  // Data rows
  chartRows: MdicComexAggregatedRow[];
  tableRows: MdicComexAggregatedRow[];
  chartLoading: boolean;
  tableLoading: boolean;
  tableData: TableRow[];

  // Chart groupBy for consumers to know active mode
  chartGroupBy: MdicComexGroupBy[];

  // Export state
  exportOpen: boolean;
  setExportOpen: (v: boolean) => void;
  excelLoading: boolean;
  csvLoading: boolean;
  exportFlow: string;
  setExportFlow: (v: string) => void;
  exportNcms: string[];
  setExportNcms: (v: string[]) => void;
  exportRange: [number, number];
  setExportRange: (v: [number, number]) => void;
  exportGranularity: MdicComexGranularity;
  setExportGranularity: (v: MdicComexGranularity) => void;
  exportRawCount: number | null;
  exportFilters: MdicComexAggregatedFilters;
  rawOverExcel: boolean;
  rawOverAbs: boolean;
  openExportModal: () => void;
  handleExportExcel: () => Promise<void>;
  handleExportCsv: () => Promise<void>;
  setExportRawCount: (v: number | null) => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useMdicComexData(): UseMdicComexData {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("mdic-comex");
  const supabase = getSupabaseClient();

  const [loading, setLoading]           = useState(true);
  const [anos, setAnos]                 = useState<number[]>([]);
  const [allPaises, setAllPaises]       = useState<string[]>([]);
  const [yearRange, setYearRange]       = useState<[number, number]>([0, 0]);
  const [selectedNCMs, setSelectedNCMs] = useState<string[]>(ALL_NCMS);
  const [selectedPaises, setSelectedPaises] = useState<string[]>([]);
  const [metric, setMetric]             = useState<Metric>("volume");
  const [viewMode, setViewMode]         = useState<ViewMode>("consolidated");
  const [showIndividualWarn, setShowIndividualWarn] = useState(false);

  const [chartRows, setChartRows] = useState<MdicComexAggregatedRow[]>([]);
  const [tableRows, setTableRows] = useState<MdicComexAggregatedRow[]>([]);

  // Export state
  const [exportOpen, setExportOpen]       = useState(false);
  const [excelLoading, setExcelLoading]   = useState(false);
  const [csvLoading, setCsvLoading]       = useState(false);
  const [exportFlow, setExportFlow]       = useState<string>("ALL");
  const [exportNcms, setExportNcms]       = useState<string[]>(ALL_NCMS);
  const [exportRange, setExportRange]     = useState<[number, number]>([0, 0]);
  const [exportGranularity, setExportGranularity] = useState<MdicComexGranularity>("raw");
  const [exportRawCount, setExportRawCount]       = useState<number | null>(null);

  const hasYears = anos.length > 0;
  const yMin     = hasYears ? anos[yearRange[0]] : null;
  const yMax     = hasYears ? anos[yearRange[1]] : null;

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const filtros = await rpcGetMdicComexFiltros(supabase);
      if (cancelled) return;

      const a  = filtros.anos;
      const ps = (filtros.paises ?? []).sort();
      setAnos(a);
      setAllPaises(ps);
      setSelectedPaises(ps);

      if (a.length === 0) { setLoading(false); return; }

      const currentYear = new Date().getFullYear();
      const startIdx    = Math.max(0, a.findIndex(yr => yr >= currentYear - 9));
      const endIdx      = a.length - 1;
      const fromYear    = a[startIdx];
      const toYear      = a[endIdx];
      setYearRange([startIdx, endIdx]);
      setExportRange([startIdx, endIdx]);

      const [chart, table] = await Promise.all([
        rpcGetMdicComexAggregated(
          supabase,
          { flow: null, ncms: null, paises: null, anoInicio: fromYear, anoFim: toYear },
          ["ano", "mes", "flow", "ncm_codigo"],
        ),
        rpcGetMdicComexAggregated(
          supabase,
          { flow: null, ncms: null, paises: null, anoInicio: fromYear - 2, anoFim: toYear },
          ["ano", "mes", "flow"],
        ),
      ]);

      if (!cancelled) {
        setChartRows(chart);
        setTableRows(table);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // ── Debounced reactive fetch ──────────────────────────────────────────────────
  const chartGroupBy: MdicComexGroupBy[] = useMemo(
    () => viewMode === "consolidated"
      ? ["ano", "mes", "flow", "ncm_codigo"]
      : ["ano", "mes", "flow", "pais"],
    [viewMode],
  );

  const paisesFilter: string[] | null = useMemo(
    () => (selectedPaises.length === allPaises.length ? null : selectedPaises),
    [selectedPaises, allPaises],
  );

  const { data: refetchedChart, loading: chartLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin2 = anos[yearRange[0]];
      const yMax2 = anos[yearRange[1]];
      return rpcGetMdicComexAggregated(
        supabase,
        { flow: null, ncms: null, paises: paisesFilter, anoInicio: yMin2, anoFim: yMax2 },
        chartGroupBy,
      );
    },
    [supabase, loading, yearRange[0], yearRange[1], anos, chartGroupBy, JSON.stringify(paisesFilter)],
    { ms: 400, skipInitial: true },
  );

  const { data: refetchedTable, loading: tableLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin2 = anos[yearRange[0]];
      const yMax2 = anos[yearRange[1]];
      return rpcGetMdicComexAggregated(
        supabase,
        { flow: null, ncms: null, paises: paisesFilter, anoInicio: (yMin2 ?? 2015) - 2, anoFim: yMax2 },
        ["ano", "mes", "flow"],
      );
    },
    [supabase, loading, yearRange[0], yearRange[1], anos, JSON.stringify(paisesFilter)],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => { if (refetchedChart) setChartRows(refetchedChart); }, [refetchedChart]);
  useEffect(() => { if (refetchedTable) setTableRows(refetchedTable); }, [refetchedTable]);

  // Individual mode advisory
  const prevViewMode = useRef<ViewMode>("consolidated");
  useEffect(() => {
    if (viewMode === "individual" && prevViewMode.current === "consolidated") {
      if (selectedPaises.length > INDIVIDUAL_WARN_THRESHOLD) {
        setShowIndividualWarn(true);
      }
    }
    prevViewMode.current = viewMode;
  }, [viewMode, selectedPaises.length]);

  // ── Derived table data ────────────────────────────────────────────────────────
  const tableData = useMemo(() => buildTableRows(tableRows, metric), [tableRows, metric]);

  // ── NCM toggle (min 1) ────────────────────────────────────────────────────────
  const toggleNcm = useCallback((ncm: string) => {
    setSelectedNCMs(prev =>
      prev.includes(ncm)
        ? prev.length > 1 ? prev.filter(n => n !== ncm) : prev
        : [...prev, ncm]
    );
  }, []);

  const resetNcms = useCallback(() => {
    setSelectedNCMs(ALL_NCMS);
  }, []);

  // ── Export helpers ────────────────────────────────────────────────────────────
  const exportFilters = useMemo<MdicComexAggregatedFilters>(() => {
    const yMin2 = anos[exportRange[0]] ?? null;
    const yMax2 = anos[exportRange[1]] ?? null;
    return {
      flow:      exportFlow === "ALL" ? null : exportFlow,
      ncms:      exportNcms.length === ALL_NCMS.length ? null : exportNcms,
      paises:    null,
      anoInicio: yMin2,
      anoFim:    yMax2,
    };
  }, [exportFlow, exportNcms, exportRange, anos]);

  const rawOverExcel = exportGranularity === "raw" && exportRawCount !== null && exportRawCount > RAW_EXCEL_MAX_ROWS;
  const rawOverAbs   = exportGranularity === "raw" && exportRawCount !== null && exportRawCount > RAW_ABS_MAX_ROWS;

  const openExportModal = useCallback(() => {
    setExportFlow("ALL");
    setExportNcms(selectedNCMs.length ? selectedNCMs : ALL_NCMS);
    setExportRange(yearRange);
    setExportGranularity("raw");
    setExportRawCount(null);
    setExportOpen(true);
  }, [selectedNCMs, yearRange]);

  const handleExportExcel = useCallback(async () => {
    if (!supabase) return;
    if (rawOverAbs || rawOverExcel) return;
    setExcelLoading(true);
    try {
      if (exportGranularity === "raw") {
        const rows = await fetchMdicComexRawFiltered(supabase, exportFilters);
        await downloadMdicComexRawExcel(rows);
      } else {
        const groupBy = MDIC_GROUPBY_MAP[exportGranularity];
        const rows = await rpcGetMdicComexAggregated(supabase, exportFilters, groupBy);
        await downloadMdicComexAggregatedExcel(rows, groupBy);
      }
      setExportOpen(false);
    } catch (e) {
      console.error("MDIC Comex Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [supabase, rawOverAbs, rawOverExcel, exportGranularity, exportFilters]);

  const handleExportCsv = useCallback(async () => {
    if (!supabase || rawOverAbs) return;
    setCsvLoading(true);
    try {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yy = String(now.getFullYear()).slice(-2);

      if (exportGranularity === "raw") {
        const rows = await fetchMdicComexRawFiltered(supabase, exportFilters);
        downloadCsv({ rows: rows as unknown as Record<string, unknown>[], filename: `mdic_comex_raw_${dd}-${mm}-${yy}` });
      } else {
        const groupBy = MDIC_GROUPBY_MAP[exportGranularity];
        const rows = await rpcGetMdicComexAggregated(supabase, exportFilters, groupBy);
        const metricKeys = ["volume_kg", "valor_fob_usd", "quantidade_estatistica", "unidade_estatistica"] as const;
        const wantedCols = [...groupBy, ...metricKeys] as readonly string[];
        const projected = rows.map(r => {
          const out: Record<string, unknown> = {};
          for (const k of wantedCols) out[k] = (r as unknown as Record<string, unknown>)[k];
          return out;
        });
        downloadCsv({ rows: projected, filename: `mdic_comex_${exportGranularity}_${dd}-${mm}-${yy}` });
      }
      setExportOpen(false);
    } catch (e) {
      console.error("MDIC Comex CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
  }, [supabase, rawOverAbs, exportGranularity, exportFilters]);

  return {
    loading,
    visLoading,
    visible,
    anos,
    allPaises,
    yearRange,
    setYearRange,
    selectedNCMs,
    toggleNcm,
    resetNcms,
    selectedPaises,
    setSelectedPaises,
    metric,
    setMetric,
    viewMode,
    setViewMode,
    showIndividualWarn,
    setShowIndividualWarn,
    hasYears,
    yMin,
    yMax,
    paisesFilter,
    chartRows,
    tableRows,
    chartLoading,
    tableLoading,
    tableData,
    chartGroupBy,
    exportOpen,
    setExportOpen,
    excelLoading,
    csvLoading,
    exportFlow,
    setExportFlow,
    exportNcms,
    setExportNcms,
    exportRange,
    setExportRange,
    exportGranularity,
    setExportGranularity,
    exportRawCount,
    setExportRawCount,
    exportFilters,
    rawOverExcel,
    rawOverAbs,
    openExportModal,
    handleExportExcel,
    handleExportCsv,
  };
}
