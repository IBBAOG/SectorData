"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import BrandLogo from "../../../components/BrandLogo";
import PlotlyChart from "../../../components/PlotlyChart";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../components/dashboard/ExportPanel";
import ExportModal from "../../../components/dashboard/ExportModal";
import SegmentedToggle from "../../../components/dashboard/SegmentedToggle";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../lib/plotlyDefaults";
import {
  rpcGetMdicComexAggregated,
  rpcGetMdicComexFiltros,
  getMdicComexExportCount,
  fetchMdicComexRawFiltered,
  type MdicComexAggregatedRow,
  type MdicComexAggregatedFilters,
  type MdicComexGroupBy,
} from "../../../lib/rpc";
import {
  downloadMdicComexRawExcel,
  downloadMdicComexAggregatedExcel,
} from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";

// ── Constants ─────────────────────────────────────────────────────────────────

const M3_TO_BBL = 6.28981; // industry standard: 1 m³ = 6.28981 bbl

const NCM_DENSITY_KG_PER_M3: Record<string, number> = {
  "27090010": 870, // crude oil
  "27101259": 745, // gasoline
  "27101921": 832, // diesel
};

/** Derive volume in m³ from net weight using standard ANP densities. */
function volumeM3(r: { volume_kg?: number | null; ncm_codigo?: string | null }): number | null {
  if (!r.volume_kg || r.volume_kg <= 0) return null;
  const density = r.ncm_codigo ? NCM_DENSITY_KG_PER_M3[r.ncm_codigo] : undefined;
  if (!density) return null;
  return r.volume_kg / density;
}

const NCM_INFO: Record<string, { label: string; color: string }> = {
  "27090010": { label: "Crude Oil", color: "#1a1a1a" },
  "27101259": { label: "Gasoline",  color: "#FF5000" },
  "27101921": { label: "Diesel",    color: "#2196F3" },
};
const ALL_NCMS = Object.keys(NCM_INFO);

// Threshold for Individual mode advisory warning
const INDIVIDUAL_WARN_THRESHOLD = 20;

// ── Metric toggle ─────────────────────────────────────────────────────────────

type Metric = "volume" | "volume_m3" | "fob" | "fob_per_ton" | "fob_per_m3" | "fob_per_bbl";

const METRIC_OPTIONS: Array<{ value: Metric; label: string }> = [
  { value: "volume",      label: "Volume (kt)" },
  { value: "volume_m3",   label: "Volume (k m³)" },
  { value: "fob",         label: "FOB (USD M)" },
  { value: "fob_per_ton", label: "FOB / ton" },
  { value: "fob_per_m3",  label: "FOB / m³" },
  { value: "fob_per_bbl", label: "FOB / bbl" },
];

type MetricRow = {
  volume_kg:     number | null;
  valor_fob_usd: number | null;
  ncm_codigo?:   string | null;
};

const METRIC_CONFIG: Record<Metric, {
  axisTitle:    () => string;
  hoverUnit:    () => string;
  tableHeader:  () => string;
  select:       (r: MetricRow) => number | null;
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

// ── View mode toggle ──────────────────────────────────────────────────────────

type ViewMode = "consolidated" | "individual";
const VIEW_MODE_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "consolidated", label: "Consolidated" },
  { value: "individual",   label: "Individual" },
];

// ── Export constants ──────────────────────────────────────────────────────────

const RAW_EXCEL_MAX_ROWS = 200_000;
const RAW_ABS_MAX_ROWS   = 500_000;

type MdicComexGranularity = "raw" | "ncm" | "pais" | "flow" | "ano_mes";

const MDIC_GROUPBY_MAP: Record<Exclude<MdicComexGranularity, "raw">, MdicComexGroupBy[]> = {
  ncm:     ["ano", "mes", "ncm_codigo", "ncm_nome"],
  pais:    ["ano", "mes", "pais"],
  flow:    ["ano", "mes", "flow"],
  ano_mes: ["ano", "mes"],
};

const MDIC_GRANULARITY_OPTIONS: Array<{
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

const MDIC_AGG_ESTIMATE: Record<Exclude<MdicComexGranularity, "raw">, number> = {
  ano_mes: 252,
  flow:    252 * 2,
  ncm:     252 * 3,
  pais:    252 * 60,
};

// ── Chart helpers ─────────────────────────────────────────────────────────────

/** Consolidated mode: 1 line per NCM, summed across selected countries. */
function buildConsolidatedLineChart(
  rows: MdicComexAggregatedRow[],
  flow: string,
  ncms: string[],
  metric: Metric,
  suffix = "",
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r.flow === flow && r.ncm_codigo && ncms.includes(r.ncm_codigo));
  if (!filtered.length) return emptyPlot(280);

  const cfg = METRIC_CONFIG[metric];

  const byNcm: Record<string, MdicComexAggregatedRow[]> = {};
  for (const r of filtered) {
    if (r.ncm_codigo) (byNcm[r.ncm_codigo] ??= []).push(r);
  }

  const traces: PlotData[] = ncms
    .filter(ncm => byNcm[ncm])
    .map(ncm => {
      const data = byNcm[ncm].sort((a, b) =>
        (a.ano ?? 0) !== (b.ano ?? 0) ? (a.ano ?? 0) - (b.ano ?? 0) : (a.mes ?? 0) - (b.mes ?? 0)
      );
      const info = NCM_INFO[ncm];
      const unit = cfg.hoverUnit();
      return {
        type: "scatter", mode: "lines",
        name: info?.label ?? ncm,
        x: data.map(r => `${r.ano}-${String(r.mes ?? 1).padStart(2, "0")}`),
        y: data.map(r => cfg.select(r)),
        line:  { width: 2, color: info?.color ?? "#999" },
        hovertemplate: `${info?.label ?? ncm}: %{y:.2f} ${unit}<extra></extra>`,
      } as PlotData;
    });

  const axisLabel = cfg.axisTitle();
  const flowLabel = flow === "import" ? "Imports" : "Exports";
  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 10, b: 50, l: 70, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${axisLabel} / month` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
      title: suffix ? {
        text: `${flowLabel} (${axisLabel} / month)${suffix}`,
        font: { size: 13, family: "Arial" },
        x: 0, xanchor: "left" as const,
      } : undefined,
    },
  };
}

/** Individual mode: 1 line per country, summed across selected NCMs. */
function buildIndividualLineChart(
  rows: MdicComexAggregatedRow[],
  flow: string,
  metric: Metric,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r.flow === flow && r.pais);
  if (!filtered.length) return emptyPlot(280);

  const cfg = METRIC_CONFIG[metric];

  const byPais: Record<string, MdicComexAggregatedRow[]> = {};
  for (const r of filtered) {
    if (r.pais) (byPais[r.pais] ??= []).push(r);
  }

  const countries = Object.keys(byPais).sort();
  const traces: PlotData[] = countries.map((pais, idx) => {
    const data = byPais[pais].sort((a, b) =>
      (a.ano ?? 0) !== (b.ano ?? 0) ? (a.ano ?? 0) - (b.ano ?? 0) : (a.mes ?? 0) - (b.mes ?? 0)
    );
    const color = PALETTE[idx % PALETTE.length];
    const unit = cfg.hoverUnit();
    return {
      type: "scatter", mode: "lines",
      name: pais,
      x: data.map(r => `${r.ano}-${String(r.mes ?? 1).padStart(2, "0")}`),
      y: data.map(r => cfg.select(r)),
      line:  { width: 2, color },
      hovertemplate: `${pais}: %{y:.2f} ${unit}<extra></extra>`,
    } as PlotData;
  });

  const axisLabel = cfg.axisTitle();
  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 10, b: 50, l: 70, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${axisLabel} / month` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

// ── 24-month table helpers ────────────────────────────────────────────────────

type TableRow = {
  label:   string;  // "YYYY-MM"
  imp:     number | null;
  exp:     number | null;
  impMoM:  number | null;
  expMoM:  number | null;
  impYoY:  number | null;
  expYoY:  number | null;
};

function formatPct(v: number | null): { text: string; color: string } {
  if (v === null || !isFinite(v)) return { text: "—", color: "#888" };
  const sign = v >= 0 ? "+" : "";
  return {
    text:  `${sign}${v.toFixed(1)}%`,
    color: v >= 0 ? "#1b7a3e" : "#b71c1c",
  };
}

function buildTableRows(
  rows: MdicComexAggregatedRow[],
  metric: Metric,
): TableRow[] {
  // Build a lookup: "YYYY-MM" → { imp, exp }
  const byMonth: Record<string, { imp: number | null; exp: number | null }> = {};
  for (const r of rows) {
    if (r.ano == null || r.mes == null) continue;
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { imp: null, exp: null };
    const v = METRIC_CONFIG[metric].select(r);
    if (r.flow === "import") byMonth[key].imp = (byMonth[key].imp ?? 0) + (v ?? 0);
    if (r.flow === "export") byMonth[key].exp = (byMonth[key].exp ?? 0) + (v ?? 0);
  }

  // All months sorted desc
  const allKeys = Object.keys(byMonth).sort().reverse();
  if (allKeys.length < 2) return [];

  // Show 24 most recent months; need up to 36 for YoY
  const displayKeys = allKeys.slice(0, 24);

  return displayKeys.map(key => {
    const { imp, exp } = byMonth[key];

    // Previous month (1 back)
    const prevIdx  = allKeys.indexOf(key) + 1;
    const prevKey  = allKeys[prevIdx] ?? null;
    const prevImp  = prevKey ? (byMonth[prevKey]?.imp ?? null) : null;
    const prevExp  = prevKey ? (byMonth[prevKey]?.exp ?? null) : null;

    // Same month prior year (12 back)
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MdicComexPage() {
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

  // Chart data from aggregated RPC
  const [chartRows, setChartRows] = useState<MdicComexAggregatedRow[]>([]);
  // Table data (needs flow breakdown — fetched with groupBy = ['ano','mes','flow'])
  const [tableRows, setTableRows] = useState<MdicComexAggregatedRow[]>([]);

  // ── Export modal state ─────────────────────────────────────────────────────
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

  // ── Initial load ───────────────────────────────────────────────────────────
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
      setSelectedPaises(ps); // default = all selected

      if (a.length === 0) { setLoading(false); return; }

      const currentYear = new Date().getFullYear();
      const startIdx    = Math.max(0, a.findIndex(yr => yr >= currentYear - 9));
      const endIdx      = a.length - 1;
      const fromYear    = a[startIdx];
      const toYear      = a[endIdx];
      setYearRange([startIdx, endIdx]);
      setExportRange([startIdx, endIdx]);

      // Initial fetch — Consolidated groupBy (ncm) and table groupBy (flow)
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

  // ── Debounced reactive fetch ───────────────────────────────────────────────
  // groupBy depends on viewMode: consolidated → ncm_codigo; individual → pais
  const chartGroupBy: MdicComexGroupBy[] = useMemo(
    () => viewMode === "consolidated"
      ? ["ano", "mes", "flow", "ncm_codigo"]
      : ["ano", "mes", "flow", "pais"],
    [viewMode],
  );

  // paises filter: null when all selected (avoids large IN clause), list otherwise
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
      // Fetch extra 2 years so YoY has data for the oldest months shown
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

  // ── Memoised charts ────────────────────────────────────────────────────────
  const importChart = useMemo(() => {
    if (viewMode === "consolidated") {
      return buildConsolidatedLineChart(chartRows, "import", selectedNCMs, metric);
    }
    return buildIndividualLineChart(chartRows, "import", metric);
  }, [chartRows, viewMode, selectedNCMs, metric]);

  const exportChart = useMemo(() => {
    if (viewMode === "consolidated") {
      return buildConsolidatedLineChart(chartRows, "export", selectedNCMs, metric);
    }
    return buildIndividualLineChart(chartRows, "export", metric);
  }, [chartRows, viewMode, selectedNCMs, metric]);

  // ── Memoised table rows ────────────────────────────────────────────────────
  const tableData = useMemo(() => buildTableRows(tableRows, metric), [tableRows, metric]);

  // ── Dynamic chart titles ───────────────────────────────────────────────────
  const cfg = METRIC_CONFIG[metric];
  const importTitle = viewMode === "individual"
    ? `Imports (${cfg.axisTitle()} / month) — by country`
    : `Imports (${cfg.axisTitle()} / month)`;
  const exportTitle = viewMode === "individual"
    ? `Exports (${cfg.axisTitle()} / month) — by country`
    : `Exports (${cfg.axisTitle()} / month)`;

  // ── Export modal helpers ───────────────────────────────────────────────────
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

  function openExportModal() {
    setExportFlow("ALL");
    setExportNcms(selectedNCMs.length ? selectedNCMs : ALL_NCMS);
    setExportRange(yearRange);
    setExportGranularity("raw");
    setExportRawCount(null);
    setExportOpen(true);
  }

  const toggleNcm = (ncm: string) => {
    setSelectedNCMs(prev =>
      prev.includes(ncm)
        ? prev.length > 1 ? prev.filter(n => n !== ncm) : prev
        : [...prev, ncm]
    );
  };

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              {/* Product filter */}
              <MultiSelectFilter
                label="Product"
                items={ALL_NCMS}
                selected={selectedNCMs}
                onToggle={toggleNcm}
                onClear={selectedNCMs.length < ALL_NCMS.length ? () => setSelectedNCMs(ALL_NCMS) : undefined}
                swatch={(n) => NCM_INFO[n].color}
                itemLabel={(n) => NCM_INFO[n].label}
                idPrefix="ncm"
                counterTotal={ALL_NCMS.length}
              />

              {/* Country filter */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Countries
                  {allPaises.length > 0 && (
                    <span style={{ color: "#888", fontWeight: 400, marginLeft: 4 }}>
                      ({selectedPaises.length}/{allPaises.length})
                    </span>
                  )}
                </div>
                {allPaises.length > 0 && (
                  <SearchableMultiSelect
                    options={allPaises}
                    value={selectedPaises}
                    onChange={(next) => {
                      // Enforce minimum 1 country
                      if (next.length === 0) return;
                      setSelectedPaises(next);
                      // Show advisory if switching to individual mode with many countries
                      if (viewMode === "individual" && next.length > INDIVIDUAL_WARN_THRESHOLD) {
                        setShowIndividualWarn(true);
                      } else {
                        setShowIndividualWarn(false);
                      }
                    }}
                  />
                )}
              </div>

              {/* View mode toggle */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View mode</div>
                <SegmentedToggle<ViewMode>
                  options={VIEW_MODE_OPTIONS}
                  value={viewMode}
                  onChange={(v) => {
                    setViewMode(v);
                    if (v === "individual" && selectedPaises.length > INDIVIDUAL_WARN_THRESHOLD) {
                      setShowIndividualWarn(true);
                    } else {
                      setShowIndividualWarn(false);
                    }
                  }}
                />
              </div>

              {/* Period filter */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasYears && (
                  <PeriodSlider years={anos} value={yearRange} onChange={setYearRange} />
                )}
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="MDIC Comex Stat — Imports and Exports"
                sub="Monthly import and export volumes of crude oil, gasoline, and diesel by NCM and origin/destination country"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "Excel",
                        disabled: loading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                      {
                        kind: "csv",
                        label: "CSV",
                        disabled: loading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                    ]}
                  />
                }
              />

              {/* Metric toggle */}
              {!loading && (
                <div style={{ maxWidth: 840, margin: "0 auto 16px auto" }}>
                  <SegmentedToggle<Metric>
                    options={METRIC_OPTIONS}
                    value={metric}
                    onChange={setMetric}
                  />
                </div>
              )}

              {/* Individual mode advisory */}
              {!loading && showIndividualWarn && (
                <div
                  style={{
                    maxWidth: 840,
                    margin: "0 auto 12px auto",
                    fontSize: 12,
                    color: "#7a5200",
                    backgroundColor: "#fff8e1",
                    border: "1px solid #ffe082",
                    borderRadius: 4,
                    padding: "8px 12px",
                    lineHeight: 1.5,
                    fontFamily: "Arial",
                  }}
                >
                  Individual mode shows 1 series per country. Narrow your country filter to compare more clearly.
                  <button
                    type="button"
                    onClick={() => setShowIndividualWarn(false)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      float: "right", fontSize: 13, color: "#999", lineHeight: 1,
                    }}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              )}

              {loading ? (
                <BarrelLoading />
              ) : (
                <>
                  {/* Imports chart */}
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection title={importTitle} loading={chartLoading} height={280}>
                        <PlotlyChart
                          data={importChart.data}
                          layout={importChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  {/* Exports chart */}
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection title={exportTitle} loading={chartLoading} height={280}>
                        <PlotlyChart
                          data={exportChart.data}
                          layout={exportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  {/* 24-month table */}
                  <div className="row mb-4">
                    <div className="col-12">
                      <div
                        className="chart-container"
                        style={{ position: "relative", opacity: tableLoading ? 0.5 : 1 }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "Arial", marginBottom: 10 }}>
                          Monthly Summary — Last 24 Months
                          <span style={{ fontSize: 11, fontWeight: 400, color: "#888", marginLeft: 8 }}>
                            ({cfg.tableHeader()} / month, active filters)
                          </span>
                        </div>
                        {tableData.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial" }}>
                            No data for the selected period.
                          </div>
                        ) : (
                          <div style={{ overflowX: "auto" }}>
                            <table
                              className="table table-sm table-hover"
                              style={{ fontFamily: "Arial", fontSize: 12, minWidth: 620 }}
                            >
                              <thead>
                                <tr style={{ backgroundColor: "#f8f8f8" }}>
                                  <th style={{ width: 90, fontWeight: 700 }}>Month</th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>
                                    Imports ({cfg.tableHeader()})
                                  </th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>
                                    Exports ({cfg.tableHeader()})
                                  </th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>IMP MoM%</th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>EXP MoM%</th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>IMP YoY%</th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>EXP YoY%</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tableData.map(row => {
                                  const impMoM = formatPct(row.impMoM);
                                  const expMoM = formatPct(row.expMoM);
                                  const impYoY = formatPct(row.impYoY);
                                  const expYoY = formatPct(row.expYoY);
                                  return (
                                    <tr key={row.label}>
                                      <td style={{ fontWeight: 600, color: "#1a1a1a" }}>{row.label}</td>
                                      <td style={{ textAlign: "right" }}>
                                        {row.imp != null ? row.imp.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"}
                                      </td>
                                      <td style={{ textAlign: "right" }}>
                                        {row.exp != null ? row.exp.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"}
                                      </td>
                                      <td style={{ textAlign: "right", color: impMoM.color, fontWeight: impMoM.text !== "—" ? 600 : 400 }}>
                                        {impMoM.text}
                                      </td>
                                      <td style={{ textAlign: "right", color: expMoM.color, fontWeight: expMoM.text !== "—" ? 600 : 400 }}>
                                        {expMoM.text}
                                      </td>
                                      <td style={{ textAlign: "right", color: impYoY.color, fontWeight: impYoY.text !== "—" ? 600 : 400 }}>
                                        {impYoY.text}
                                      </td>
                                      <td style={{ textAlign: "right", color: expYoY.color, fontWeight: expYoY.text !== "—" ? 600 : 400 }}>
                                        {expYoY.text}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export — MDIC Comex"
        datasetKey="mdic_comex"
        currentFilters={{ ...exportFilters, _g: exportGranularity }}
        countFetcher={async () => {
          if (!supabase) return 0;
          if (exportGranularity !== "raw") {
            setExportRawCount(null);
            return MDIC_AGG_ESTIMATE[exportGranularity];
          }
          const c = await getMdicComexExportCount(supabase, exportFilters);
          setExportRawCount(c);
          return c;
        }}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={async () => {
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
        }}
        onExportCsv={async () => {
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
        }}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Granularity
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {MDIC_GRANULARITY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="form-check" style={{ marginBottom: 0 }}>
                    <input
                      className="form-check-input"
                      type="radio"
                      id={`mdic-export-g-${opt.value}`}
                      name="mdic-export-granularity"
                      checked={exportGranularity === opt.value}
                      onChange={() => setExportGranularity(opt.value)}
                    />
                    <label
                      className="form-check-label"
                      htmlFor={`mdic-export-g-${opt.value}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}
                    >
                      <strong>{opt.label}</strong>
                      <span style={{ color: "#888", marginLeft: 6, fontSize: 11 }}>— {opt.hint}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {rawOverAbs && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#7a1a1a", backgroundColor: "#fdecea", border: "1px solid #f5c2bc", borderRadius: 4, padding: "8px 10px", lineHeight: 1.4 }}>
                Very high volume ({(exportRawCount ?? 0).toLocaleString("en-US")} rows). Choose an <strong>aggregated granularity</strong> or apply more filters.
              </div>
            )}
            {!rawOverAbs && rawOverExcel && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#7a4a00", backgroundColor: "#fff3cd", border: "1px solid #ffe69c", borderRadius: 4, padding: "8px 10px", lineHeight: 1.4 }}>
                High volume for Excel ({(exportRawCount ?? 0).toLocaleString("en-US")} rows). We recommend <strong>CSV</strong>.
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Period</div>
              {hasYears && <PeriodSlider years={anos} value={exportRange} onChange={setExportRange} />}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Flow</div>
              <select
                className="form-select form-select-sm"
                value={exportFlow}
                onChange={e => setExportFlow(e.target.value)}
                style={{ fontFamily: "Arial", fontSize: 12, maxWidth: 220 }}
              >
                <option value="ALL">Imports + Exports</option>
                <option value="import">Imports</option>
                <option value="export">Exports</option>
              </select>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>NCMs</div>
              <MultiSelectFilter
                label="NCMs"
                items={ALL_NCMS}
                selected={exportNcms}
                onToggle={(ncm) =>
                  setExportNcms(prev =>
                    prev.includes(ncm)
                      ? prev.length > 1 ? prev.filter(n => n !== ncm) : prev
                      : [...prev, ncm]
                  )
                }
                onClear={exportNcms.length < ALL_NCMS.length ? () => setExportNcms(ALL_NCMS) : undefined}
                swatch={(n) => NCM_INFO[n].color}
                itemLabel={(n) => NCM_INFO[n].label}
                idPrefix="ncm-export"
                counterTotal={ALL_NCMS.length}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
