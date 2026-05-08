"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
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
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpCdpDiariaFiltros,
  rpcGetAnpCdpDiariaSerie,
  rpcGetAnpCdpDiariaInstalacaoFiltros,
  rpcGetAnpCdpDiariaInstalacaoSerie,
  rpcGetAnpCdpDiariaPocoFiltros,
  rpcGetAnpCdpDiariaPocoSerie,
  type AnpCdpDiariaPonto,
  type AnpCdpDiariaInstalacaoPonto,
  type AnpCdpDiariaPocoPonto,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
];

const TOP_N = 10;

type Metric = "petroleo_bbl_dia" | "gas_mm3_dia";
type Granularity = "field" | "installation" | "well";

// Unified row shape used by chart/table builders. The "dimension" field varies
// by granularity (campo / instalacao / poco) — we project source rows into this
// shape after fetching so all downstream code is level-agnostic.
type UnifiedRow = {
  data: string;
  campo: string;
  bacia: string | null;          // installation level has no bacia
  dimension: string;             // the grouping key for charts/table (campo | instalacao | poco)
  petroleo_bbl_dia: number | null;
  gas_mm3_dia: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickTopDimensions(
  rows: UnifiedRow[],
  metric: Metric,
  n: number,
): string[] {
  const sums: Record<string, { sum: number; cnt: number }> = {};
  for (const r of rows) {
    const v = r[metric];
    if (v == null) continue;
    if (!sums[r.dimension]) sums[r.dimension] = { sum: 0, cnt: 0 };
    sums[r.dimension].sum += v;
    sums[r.dimension].cnt += 1;
  }
  return Object.entries(sums)
    .map(([k, v]) => [k, v.cnt > 0 ? v.sum / v.cnt : 0] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function buildSerieChart(
  rows: UnifiedRow[],
  metric: Metric,
  dims: string[],
  unitLabel: string,
  height: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => dims.includes(r.dimension) && r[metric] != null);
  if (!filtered.length) return emptyPlot(height);

  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    if (!agg[r.dimension]) agg[r.dimension] = {};
    const v = r[metric] ?? 0;
    agg[r.dimension][r.data] = (agg[r.dimension][r.data] ?? 0) + v;
  }

  const traces: PlotData[] = dims
    .filter(c => agg[c])
    .map((c, i) => {
      const entries = Object.entries(agg[c]).sort(([a], [b]) => a.localeCompare(b));
      return {
        type: "scatter", mode: "lines",
        name: c,
        x: entries.map(([d]) => d),
        y: entries.map(([, v]) => v),
        line: { width: 1.5, color: PALETTE[i % PALETTE.length] },
        hovertemplate: `${c}: %{y:,.1f} ${unitLabel}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: unitLabel } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function fmtNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

// Build daily date list between data_min/data_max for the slider.
function buildDateRange(min: string, max: string): string[] {
  const out: string[] = [];
  const start = new Date(min + "T00:00:00Z");
  const end   = new Date(max + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Granularity-aware projector: maps the level-specific row shape to UnifiedRow.
function projectField(rows: AnpCdpDiariaPonto[]): UnifiedRow[] {
  return rows.map(r => ({
    data: r.data,
    campo: r.campo,
    bacia: r.bacia,
    dimension: r.campo,
    petroleo_bbl_dia: r.petroleo_bbl_dia,
    gas_mm3_dia: r.gas_mm3_dia,
  }));
}
function projectInstallation(rows: AnpCdpDiariaInstalacaoPonto[]): UnifiedRow[] {
  return rows.map(r => ({
    data: r.data,
    campo: r.campo,
    bacia: null,
    dimension: r.instalacao,
    petroleo_bbl_dia: r.petroleo_bbl_dia,
    gas_mm3_dia: r.gas_mm3_dia,
  }));
}
function projectWell(rows: AnpCdpDiariaPocoPonto[]): UnifiedRow[] {
  return rows.map(r => ({
    data: r.data,
    campo: r.campo,
    bacia: r.bacia,
    dimension: r.poco,
    petroleo_bbl_dia: r.petroleo_bbl_dia,
    gas_mm3_dia: r.gas_mm3_dia,
  }));
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpDiariaPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-diaria");
  const supabase = getSupabaseClient();

  // ── Granularity (Field / Installation / Well) ───────────────────────────
  const [granularity, setGranularity] = useState<Granularity>("field");

  // ── Loading state ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);

  // ── Filter universes (per level) ────────────────────────────────────────
  const [campos, setCampos]             = useState<string[]>([]);
  const [bacias, setBacias]             = useState<string[]>([]);
  const [instalacoes, setInstalacoes]   = useState<string[]>([]);
  const [pocos, setPocos]               = useState<string[]>([]);

  // ── Series rows (unified shape) ─────────────────────────────────────────
  const [serieRows, setSerieRows] = useState<UnifiedRow[]>([]);

  // ── Period slider ───────────────────────────────────────────────────────
  const [allDates, setAllDates] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[number, number]>([0, 0]);

  // ── User selections (sidebar) ───────────────────────────────────────────
  const [selectedCampos, setSelectedCampos]           = useState<string[]>([]);
  const [selectedBacias, setSelectedBacias]           = useState<string[]>([]);
  const [selectedInstalacoes, setSelectedInstalacoes] = useState<string[]>([]);
  const [selectedPocos, setSelectedPocos]             = useState<string[]>([]);

  // ── Export modal state (Tier 2) ─────────────────────────────────────────
  const [exportOpen, setExportOpen]               = useState(false);
  const [excelLoading, setExcelLoading]           = useState(false);
  const [csvLoading, setCsvLoading]               = useState(false);
  const [exportCampos, setExportCampos]           = useState<string[]>([]);
  const [exportBacias, setExportBacias]           = useState<string[]>([]);
  const [exportInstalacoes, setExportInstalacoes] = useState<string[]>([]);
  const [exportPocos, setExportPocos]             = useState<string[]>([]);
  const [exportRange, setExportRange]             = useState<[number, number]>([0, 0]);

  // ── Granularity-aware loaders ───────────────────────────────────────────
  // Triggered on initial mount AND whenever `granularity` changes.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setLoading(true);

    // Reset filters on level change so we never carry stale selections
    // between universes of different vocabularies.
    setSelectedCampos([]);
    setSelectedBacias([]);
    setSelectedInstalacoes([]);
    setSelectedPocos([]);
    setSerieRows([]);

    (async () => {
      try {
        if (granularity === "field") {
          const f = await rpcGetAnpCdpDiariaFiltros(supabase);
          if (cancelled) return;
          setCampos(f.campos);
          setBacias(f.bacias);
          setInstalacoes([]);
          setPocos([]);
          const dates = (f.data_min && f.data_max) ? buildDateRange(f.data_min, f.data_max) : [];
          setAllDates(dates);
          const lastIdx = Math.max(0, dates.length - 1);
          setDateRange([0, lastIdx]);
          const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
            dataInicio: f.data_min ?? null,
            dataFim:    f.data_max ?? null,
          });
          if (!cancelled) setSerieRows(projectField(rows));
        } else if (granularity === "installation") {
          const f = await rpcGetAnpCdpDiariaInstalacaoFiltros(supabase);
          if (cancelled) return;
          setCampos(f.campos);
          setBacias([]);
          setInstalacoes(f.instalacoes);
          setPocos([]);
          const dates = (f.data_min && f.data_max) ? buildDateRange(f.data_min, f.data_max) : [];
          setAllDates(dates);
          const lastIdx = Math.max(0, dates.length - 1);
          setDateRange([0, lastIdx]);
          const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
            dataInicio: f.data_min ?? null,
            dataFim:    f.data_max ?? null,
          });
          if (!cancelled) setSerieRows(projectInstallation(rows));
        } else {
          // well
          const f = await rpcGetAnpCdpDiariaPocoFiltros(supabase);
          if (cancelled) return;
          setCampos(f.campos);
          setBacias(f.bacias);
          setInstalacoes([]);
          setPocos(f.pocos);
          const dates = (f.data_min && f.data_max) ? buildDateRange(f.data_min, f.data_max) : [];
          setAllDates(dates);
          const lastIdx = Math.max(0, dates.length - 1);
          setDateRange([0, lastIdx]);
          const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
            dataInicio: f.data_min ?? null,
            dataFim:    f.data_max ?? null,
          });
          if (!cancelled) setSerieRows(projectWell(rows));
        }
      } catch (e) {
        console.error("ANP CDP Diária initial load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, granularity]);

  // ── Reactive serie fetch (debounced 400ms) — period/secondary filter changes
  // We only refetch the wide window when period or the level's "non-dimension"
  // filter changes. Dimension-filter (campos at field, instalacoes at install,
  // pocos at well) is applied client-side so Top-N defaults stay stable.
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async (): Promise<UnifiedRow[] | null> => {
      if (!supabase || loading) return null;
      const dStart = allDates[dateRange[0]] ?? null;
      const dEnd   = allDates[dateRange[1]] ?? null;
      if (granularity === "field") {
        const baciasParam = selectedBacias.length > 0 && selectedBacias.length < bacias.length
          ? selectedBacias
          : null;
        const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
          bacias: baciasParam,
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return projectField(rows);
      } else if (granularity === "installation") {
        // No "secondary" wide filter at installation level beyond campos.
        // Push selectedCampos to the RPC only if non-empty (keeps payload small).
        const camposParam = selectedCampos.length > 0 && selectedCampos.length < campos.length
          ? selectedCampos
          : null;
        const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
          campos:     camposParam,
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return projectInstallation(rows);
      } else {
        const baciasParam = selectedBacias.length > 0 && selectedBacias.length < bacias.length
          ? selectedBacias
          : null;
        const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
          bacias:     baciasParam,
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return projectWell(rows);
      }
    },
    [
      supabase, loading, granularity,
      dateRange[0], dateRange[1], allDates,
      selectedBacias, bacias.length,
      selectedCampos, campos.length,
    ],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  // ── Dimension selection (per level), used for chart & table ─────────────
  // At each level the "dimension" we group the chart by:
  //   field        -> campo
  //   installation -> instalacao
  //   well         -> poco
  //
  // If the user has explicitly selected dimensions, those override Top-N.
  const explicitDims = useMemo(() => {
    if (granularity === "field")        return selectedCampos;
    if (granularity === "installation") return selectedInstalacoes;
    return selectedPocos;
  }, [granularity, selectedCampos, selectedInstalacoes, selectedPocos]);

  const defaultPetroleoDims = useMemo(
    () => pickTopDimensions(serieRows, "petroleo_bbl_dia", TOP_N),
    [serieRows],
  );
  const defaultGasDims = useMemo(
    () => pickTopDimensions(serieRows, "gas_mm3_dia", TOP_N),
    [serieRows],
  );

  const dimsPetroleoChart = explicitDims.length > 0 ? explicitDims : defaultPetroleoDims;
  const dimsGasChart      = explicitDims.length > 0 ? explicitDims : defaultGasDims;

  // ── Client-side filtering by campo/bacia/poco for chart/table when those
  //    filters are NOT pushed to the RPC (e.g. campos at field level).
  const visibleRows = useMemo(() => {
    let rows = serieRows;
    if (granularity === "field") {
      // bacias goes via RPC, campo is client-side
      if (selectedCampos.length > 0) {
        const set = new Set(selectedCampos);
        rows = rows.filter(r => set.has(r.campo));
      }
    } else if (granularity === "installation") {
      // campos goes via RPC, instalacao is client-side
      if (selectedInstalacoes.length > 0) {
        const set = new Set(selectedInstalacoes);
        rows = rows.filter(r => set.has(r.dimension));
      }
    } else {
      // bacias goes via RPC, campo and poco are client-side
      if (selectedCampos.length > 0) {
        const set = new Set(selectedCampos);
        rows = rows.filter(r => set.has(r.campo));
      }
      if (selectedPocos.length > 0) {
        const set = new Set(selectedPocos);
        rows = rows.filter(r => set.has(r.dimension));
      }
    }
    return rows;
  }, [serieRows, granularity, selectedCampos, selectedInstalacoes, selectedPocos]);

  const petroleoChart = useMemo(
    () => buildSerieChart(visibleRows, "petroleo_bbl_dia", dimsPetroleoChart, "bbl/dia", 320),
    [visibleRows, dimsPetroleoChart],
  );
  const gasChart = useMemo(
    () => buildSerieChart(visibleRows, "gas_mm3_dia", dimsGasChart, "Mm³/dia", 320),
    [visibleRows, dimsGasChart],
  );

  // ── Recent rows for table (sorted desc) ─────────────────────────────────
  const tableRows = useMemo(() => {
    return [...visibleRows]
      .sort((a, b) => b.data.localeCompare(a.data) || b.dimension.localeCompare(a.dimension))
      .slice(0, 500);
  }, [visibleRows]);

  // ── Title labels per level ──────────────────────────────────────────────
  const dimLabel = useMemo(() => {
    if (granularity === "field")        return { singular: "Campo",       plural: "campo(s)",       en: "Field" };
    if (granularity === "installation") return { singular: "Instalação",  plural: "instalação(ões)", en: "Installation" };
    return                                       { singular: "Poço",        plural: "poço(s)",        en: "Well" };
  }, [granularity]);

  // ── Export modal helpers ────────────────────────────────────────────────
  function openExportModal() {
    setExportCampos([]);
    setExportBacias([]);
    setExportInstalacoes([]);
    setExportPocos([]);
    setExportRange(dateRange);
    setExportOpen(true);
  }

  // Heuristic: refetch with export filters and use length. Same approach as
  // the original Field-level page.
  async function estimateExportRows(): Promise<number> {
    if (!supabase) return 0;
    const dStart = allDates[exportRange[0]] ?? null;
    const dEnd   = allDates[exportRange[1]] ?? null;
    try {
      if (granularity === "field") {
        const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
          campos:     exportCampos.length > 0 ? exportCampos : null,
          bacias:     exportBacias.length > 0 ? exportBacias : null,
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return rows.length;
      } else if (granularity === "installation") {
        const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
          campos:      exportCampos.length > 0      ? exportCampos      : null,
          instalacoes: exportInstalacoes.length > 0 ? exportInstalacoes : null,
          dataInicio:  dStart,
          dataFim:     dEnd,
        });
        return rows.length;
      } else {
        const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
          campos:     exportCampos.length > 0 ? exportCampos : null,
          bacias:     exportBacias.length > 0 ? exportBacias : null,
          pocos:      exportPocos.length > 0  ? exportPocos  : null,
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return rows.length;
      }
    } catch (e) {
      console.error("anp-cdp-diaria export count failed", e);
      return 0;
    }
  }

  const exportFilters = useMemo(() => {
    const dStart = allDates[exportRange[0]] ?? null;
    const dEnd   = allDates[exportRange[1]] ?? null;
    return {
      campos:      exportCampos.length      > 0 ? exportCampos      : null,
      bacias:      exportBacias.length      > 0 ? exportBacias      : null,
      instalacoes: exportInstalacoes.length > 0 ? exportInstalacoes : null,
      pocos:       exportPocos.length       > 0 ? exportPocos       : null,
      dataInicio:  dStart,
      dataFim:     dEnd,
    };
  }, [exportCampos, exportBacias, exportInstalacoes, exportPocos, exportRange, allDates]);

  if (visLoading || !visible) return null;

  // ── UI helpers ───────────────────────────────────────────────────────────
  const toggleBacia = (b: string) =>
    setSelectedBacias(prev =>
      prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]
    );

  const hasDates = allDates.length > 0;
  const dStart   = hasDates ? allDates[dateRange[0]] : null;
  const dEnd     = hasDates ? allDates[dateRange[1]] : null;
  const periodBadge: [string, string] | null =
    hasDates && dStart && dEnd ? [dStart, dEnd] : null;

  // Dataset key for export size heuristic
  const datasetKey =
    granularity === "field"        ? "anp_cdp_diaria" :
    granularity === "installation" ? "anp_cdp_diaria_instalacao" :
                                     "anp_cdp_diaria_poco";

  // Header subtitle per level
  const headerSub =
    granularity === "field"        ? "Petróleo e gás natural por campo, atualizado 3×/dia (fonte: Power BI ANP)" :
    granularity === "installation" ? "Petróleo e gás natural por instalação, atualizado 3×/dia (fonte: Power BI ANP)" :
                                     "Petróleo e gás natural por poço, atualizado 3×/dia (fonte: Power BI ANP)";

  const headerTitle =
    granularity === "field"        ? "ANP CDP — Produção Diária por Campo" :
    granularity === "installation" ? "ANP CDP — Produção Diária por Instalação" :
                                     "ANP CDP — Produção Diária por Poço";

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "100%", maxWidth: 300, height: 60,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "2px dashed #ccc", color: "#aaa", fontSize: 18,
                  fontWeight: 700, letterSpacing: 3, marginBottom: 16, borderRadius: 6,
                }}>TBD</div>
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              {/* ── Granularity toggle (pill) ───────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Granularity</div>
                <SegmentedToggle<Granularity>
                  value={granularity}
                  onChange={setGranularity}
                  options={[
                    { value: "field",        label: "Field" },
                    { value: "installation", label: "Installation" },
                    { value: "well",         label: "Well" },
                  ]}
                />
              </div>

              <div className="sidebar-section-label">Filtros</div>

              {/* Bacia — visible only at field & well levels */}
              {(granularity === "field" || granularity === "well") && (
                <MultiSelectFilter
                  label={`Bacia (${selectedBacias.length || bacias.length}/${bacias.length})`}
                  items={bacias}
                  selected={selectedBacias}
                  onToggle={toggleBacia}
                  onClear={selectedBacias.length > 0 ? () => setSelectedBacias([]) : undefined}
                  idPrefix="cdpd-bacia"
                  emptyMeansAll
                  counterTotal={bacias.length}
                />
              )}

              {/* Campo — visible at all levels */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Campo{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length}/{campos.length})
                  </span>
                </div>
                <SearchableMultiSelect
                  options={campos}
                  value={selectedCampos}
                  onChange={setSelectedCampos}
                />
                {granularity === "field" && selectedCampos.length === 0 && (
                  <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingLeft: 2 }}>
                    Sem seleção: gráficos mostram Top {TOP_N} por média no período.
                  </div>
                )}
              </div>

              {/* Instalação — installation level only */}
              {granularity === "installation" && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">
                    Instalação{" "}
                    <span style={{ color: "#888", fontWeight: 400 }}>
                      ({selectedInstalacoes.length}/{instalacoes.length})
                    </span>
                  </div>
                  <SearchableMultiSelect
                    options={instalacoes}
                    value={selectedInstalacoes}
                    onChange={setSelectedInstalacoes}
                  />
                  {selectedInstalacoes.length === 0 && (
                    <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingLeft: 2 }}>
                      Sem seleção: gráficos mostram Top {TOP_N} por média no período.
                    </div>
                  )}
                </div>
              )}

              {/* Poço — well level only */}
              {granularity === "well" && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">
                    Poço{" "}
                    <span style={{ color: "#888", fontWeight: 400 }}>
                      ({selectedPocos.length}/{pocos.length})
                    </span>
                  </div>
                  <SearchableMultiSelect
                    options={pocos}
                    value={selectedPocos}
                    onChange={setSelectedPocos}
                  />
                  {selectedPocos.length === 0 && (
                    <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingLeft: 2 }}>
                      Sem seleção: gráficos mostram Top {TOP_N} por média no período.
                    </div>
                  )}
                </div>
              )}

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasDates && (
                  <PeriodSlider dates={allDates} value={dateRange} onChange={setDateRange} />
                )}
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title={headerTitle}
                sub={headerSub}
                period={periodBadge}
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

              {loading ? (
                <BarrelLoading />
              ) : serieRows.length === 0 ? (
                <div style={{
                  padding: "40px 24px", textAlign: "center", color: "#888",
                  fontFamily: "Arial", fontSize: 14, border: "1px dashed #ddd",
                  borderRadius: 8, marginTop: 12,
                }}>
                  Sem dados de produção {dimLabel.en.toLowerCase()} ainda.
                  {granularity !== "field" && " O ETL desta granularidade roda 3×/dia — aguarde primeiro pull pós-deploy."}
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={
                          explicitDims.length > 0
                            ? `Petróleo (bbl/dia) — ${explicitDims.length} ${dimLabel.plural} selecionado(s)`
                            : `Petróleo (bbl/dia) — Top ${TOP_N} ${dimLabel.singular.toLowerCase()}(s) por média no período`
                        }
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={petroleoChart.data}
                          layout={petroleoChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={
                          explicitDims.length > 0
                            ? `Gás (Mm³/dia) — ${explicitDims.length} ${dimLabel.plural} selecionado(s)`
                            : `Gás (Mm³/dia) — Top ${TOP_N} ${dimLabel.singular.toLowerCase()}(s) por média no período`
                        }
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={gasChart.data}
                          layout={gasChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Production by ${dimLabel.en} — registros mais recentes (${tableRows.length.toLocaleString("pt-BR")} de ${visibleRows.length.toLocaleString("pt-BR")})`}
                        loading={serieLoading}
                      >
                        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto", border: "1px solid #eee", borderRadius: 6 }}>
                          <table className="table table-sm" style={{ fontFamily: "Arial", fontSize: 12, marginBottom: 0 }}>
                            <thead style={{ position: "sticky", top: 0, background: "#fff", zIndex: 1, borderBottom: "2px solid #1a1a1a" }}>
                              <tr>
                                <th style={{ padding: "8px 12px", textAlign: "left" }}>Data</th>
                                {granularity === "field" && (
                                  <>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Bacia</th>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Campo</th>
                                  </>
                                )}
                                {granularity === "installation" && (
                                  <>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Campo</th>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Instalação</th>
                                  </>
                                )}
                                {granularity === "well" && (
                                  <>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Bacia</th>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Campo</th>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Poço</th>
                                  </>
                                )}
                                <th style={{ padding: "8px 12px", textAlign: "right" }}>Petróleo (bbl/dia)</th>
                                <th style={{ padding: "8px 12px", textAlign: "right" }}>Gás (Mm³/dia)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tableRows.map((r, i) => (
                                <tr key={`${r.data}-${r.campo}-${r.dimension}-${i}`}>
                                  <td style={{ padding: "6px 12px" }}>{r.data}</td>
                                  {granularity === "field" && (
                                    <>
                                      <td style={{ padding: "6px 12px" }}>{r.bacia ?? "—"}</td>
                                      <td style={{ padding: "6px 12px" }}>{r.campo}</td>
                                    </>
                                  )}
                                  {granularity === "installation" && (
                                    <>
                                      <td style={{ padding: "6px 12px" }}>{r.campo}</td>
                                      <td style={{ padding: "6px 12px" }}>{r.dimension}</td>
                                    </>
                                  )}
                                  {granularity === "well" && (
                                    <>
                                      <td style={{ padding: "6px 12px" }}>{r.bacia ?? "—"}</td>
                                      <td style={{ padding: "6px 12px" }}>{r.campo}</td>
                                      <td style={{ padding: "6px 12px" }}>{r.dimension}</td>
                                    </>
                                  )}
                                  <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(r.petroleo_bbl_dia, 1)}</td>
                                  <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(r.gas_mm3_dia, 3)}</td>
                                </tr>
                              ))}
                              {tableRows.length === 0 && (
                                <tr>
                                  <td colSpan={granularity === "well" ? 6 : 5} style={{ padding: "16px 12px", color: "#888", textAlign: "center" }}>
                                    Sem dados para os filtros atuais.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </ChartSection>
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
        title={`Exportar — ANP CDP Diária (${dimLabel.en})`}
        datasetKey={datasetKey}
        currentFilters={exportFilters}
        countFetcher={estimateExportRows}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Gerando Excel..." : "Baixando CSV..."}
        onExportExcel={async () => {
          if (!supabase) return;
          setExcelLoading(true);
          try {
            if (granularity === "field") {
              const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
                campos:     exportFilters.campos,
                bacias:     exportFilters.bacias,
                dataInicio: exportFilters.dataInicio,
                dataFim:    exportFilters.dataFim,
              });
              await downloadGenericExcel<AnpCdpDiariaPonto>({
                rows,
                filename: "ANP-CDP-Diaria-Field",
                title:    "ANP — Produção Diária por Campo",
                sheetName: "Produção Diária",
                columns: [
                  { key: "data",             header: "Data" },
                  { key: "bacia",            header: "Bacia",            width: 24 },
                  { key: "campo",            header: "Campo",            width: 30 },
                  { key: "petroleo_bbl_dia", header: "Petróleo (bbl/dia)", format: "#,##0.0",  align: "right" },
                  { key: "gas_mm3_dia",      header: "Gás (Mm³/dia)",      format: "#,##0.000", align: "right" },
                ],
              });
            } else if (granularity === "installation") {
              const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
                campos:      exportFilters.campos,
                instalacoes: exportFilters.instalacoes,
                dataInicio:  exportFilters.dataInicio,
                dataFim:     exportFilters.dataFim,
              });
              await downloadGenericExcel<AnpCdpDiariaInstalacaoPonto>({
                rows,
                filename: "ANP-CDP-Diaria-Installation",
                title:    "ANP — Produção Diária por Instalação",
                sheetName: "Produção Diária",
                columns: [
                  { key: "data",             header: "Data" },
                  { key: "campo",            header: "Campo",            width: 30 },
                  { key: "instalacao",       header: "Instalação",       width: 30 },
                  { key: "petroleo_bbl_dia", header: "Petróleo (bbl/dia)", format: "#,##0.0",  align: "right" },
                  { key: "gas_mm3_dia",      header: "Gás (Mm³/dia)",      format: "#,##0.000", align: "right" },
                ],
              });
            } else {
              const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
                campos:     exportFilters.campos,
                bacias:     exportFilters.bacias,
                pocos:      exportFilters.pocos,
                dataInicio: exportFilters.dataInicio,
                dataFim:    exportFilters.dataFim,
              });
              await downloadGenericExcel<AnpCdpDiariaPocoPonto>({
                rows,
                filename: "ANP-CDP-Diaria-Well",
                title:    "ANP — Produção Diária por Poço",
                sheetName: "Produção Diária",
                columns: [
                  { key: "data",             header: "Data" },
                  { key: "bacia",            header: "Bacia",            width: 24 },
                  { key: "campo",            header: "Campo",            width: 30 },
                  { key: "poco",             header: "Poço",             width: 30 },
                  { key: "petroleo_bbl_dia", header: "Petróleo (bbl/dia)", format: "#,##0.0",  align: "right" },
                  { key: "gas_mm3_dia",      header: "Gás (Mm³/dia)",      format: "#,##0.000", align: "right" },
                ],
              });
            }
            setExportOpen(false);
          } catch (e) {
            console.error("ANP CDP Diária Excel export failed", e);
          } finally {
            setExcelLoading(false);
          }
        }}
        onExportCsv={async () => {
          if (!supabase) return;
          setCsvLoading(true);
          try {
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, "0");
            const mm = String(now.getMonth() + 1).padStart(2, "0");
            const yy = String(now.getFullYear()).slice(-2);
            const suffix = granularity === "field" ? "field" : granularity === "installation" ? "installation" : "well";
            if (granularity === "field") {
              const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
                campos:     exportFilters.campos,
                bacias:     exportFilters.bacias,
                dataInicio: exportFilters.dataInicio,
                dataFim:    exportFilters.dataFim,
              });
              downloadCsv({
                rows: rows as unknown as Record<string, unknown>[],
                filename: `anp_cdp_diaria_${suffix}_${dd}-${mm}-${yy}`,
              });
            } else if (granularity === "installation") {
              const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
                campos:      exportFilters.campos,
                instalacoes: exportFilters.instalacoes,
                dataInicio:  exportFilters.dataInicio,
                dataFim:     exportFilters.dataFim,
              });
              downloadCsv({
                rows: rows as unknown as Record<string, unknown>[],
                filename: `anp_cdp_diaria_${suffix}_${dd}-${mm}-${yy}`,
              });
            } else {
              const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
                campos:     exportFilters.campos,
                bacias:     exportFilters.bacias,
                pocos:      exportFilters.pocos,
                dataInicio: exportFilters.dataInicio,
                dataFim:    exportFilters.dataFim,
              });
              downloadCsv({
                rows: rows as unknown as Record<string, unknown>[],
                filename: `anp_cdp_diaria_${suffix}_${dd}-${mm}-${yy}`,
              });
            }
            setExportOpen(false);
          } catch (e) {
            console.error("ANP CDP Diária CSV export failed", e);
          } finally {
            setCsvLoading(false);
          }
        }}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Período</div>
              {hasDates && (
                <PeriodSlider dates={allDates} value={exportRange} onChange={setExportRange} />
              )}
            </div>

            {(granularity === "field" || granularity === "well") && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Bacias <span style={{ color: "#888", fontWeight: 400 }}>({exportBacias.length === 0 ? bacias.length : exportBacias.length}/{bacias.length})</span>
                </div>
                <MultiSelectFilter
                  label="Bacias"
                  items={bacias}
                  selected={exportBacias}
                  onToggle={(b) =>
                    setExportBacias(prev =>
                      prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]
                    )
                  }
                  onClear={exportBacias.length > 0 ? () => setExportBacias([]) : undefined}
                  idPrefix="cdpd-export-bacia"
                />
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Campos <span style={{ color: "#888", fontWeight: 400 }}>({exportCampos.length === 0 ? campos.length : exportCampos.length}/{campos.length})</span>
              </div>
              <SearchableMultiSelect
                options={campos}
                value={exportCampos}
                onChange={setExportCampos}
              />
            </div>

            {granularity === "installation" && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Instalações <span style={{ color: "#888", fontWeight: 400 }}>({exportInstalacoes.length === 0 ? instalacoes.length : exportInstalacoes.length}/{instalacoes.length})</span>
                </div>
                <SearchableMultiSelect
                  options={instalacoes}
                  value={exportInstalacoes}
                  onChange={setExportInstalacoes}
                />
              </div>
            )}

            {granularity === "well" && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Poços <span style={{ color: "#888", fontWeight: 400 }}>({exportPocos.length === 0 ? pocos.length : exportPocos.length}/{pocos.length})</span>
                </div>
                <SearchableMultiSelect
                  options={pocos}
                  value={exportPocos}
                  onChange={setExportPocos}
                />
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
