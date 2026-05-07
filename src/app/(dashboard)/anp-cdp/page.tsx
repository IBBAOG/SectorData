"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import PeriodSlider from "../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../components/dashboard/ExportPanel";
import ExportModal from "../../../components/dashboard/ExportModal";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import {
  rpcGetAnpCdpPocoSerie,
  rpcGetAnpCdpPocosJson,
  rpcGetAnpCdpFiltros,
  getAnpCdpExportCount,
  fetchAnpCdpRawFiltered,
  rpcGetAnpCdpAggregated,
  type AnpCdpSeriePonto,
  type AnpCdpPocoSimples,
  type AnpCdpFiltros,
  type AnpCdpExportCountFilters,
  type AnpCdpGroupBy,
} from "../../../lib/rpc";
import {
  downloadAnpCdpRawExcel,
  downloadAnpCdpAggregatedExcel,
} from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";

// Hard limits for raw (per-poço × per-mês) export. Above EXCEL_MAX, we
// disable the Excel button and route the user to CSV. Above ABS_MAX, both
// are disabled with a stronger warning. Numbers are conservative — the
// /anp-cdp table has ~1.8M raw rows, so the unfiltered case must always
// hit ABS_MAX and force the user to narrow filters first.
const RAW_EXCEL_MAX_ROWS = 200_000;
const RAW_ABS_MAX_ROWS   = 500_000;

// Export granularity. "raw" = 1 row per poço × mês × demais dimensões (paginated
// PostgREST). All others use the dynamic aggregator RPC; the page just maps
// each granularity to the `groupBy` array passed to `rpcGetAnpCdpAggregated`.
//
// "ambiente" maps to the SQL column `local` (the table column is named `local`,
// the dashboard label is "Ambiente").
type AnpCdpGranularity =
  | "raw"
  | "campo"
  | "bacia"
  | "operador"
  | "ambiente"
  | "ano_mes"
  | "estado";

const ANP_CDP_GROUPBY_MAP: Record<Exclude<AnpCdpGranularity, "raw">, AnpCdpGroupBy[]> = {
  campo:    ["ano", "mes", "campo"],
  bacia:    ["ano", "mes", "bacia"],
  operador: ["ano", "mes", "operador"],
  ambiente: ["ano", "mes", "local"],
  estado:   ["ano", "mes", "estado"],
  ano_mes:  ["ano", "mes"],
};

const ANP_CDP_GRANULARITY_OPTIONS: Array<{
  value: AnpCdpGranularity;
  label: string;
  hint: string;
}> = [
  { value: "raw",      label: "Por poço (raw — todas as dimensões)",       hint: "1 linha por poço × mês × demais dimensões (recomendado p/ análise)" },
  { value: "campo",    label: "Por campo (agregado por ano/mês/campo)",    hint: "soma das métricas por (ano, mês, campo)" },
  { value: "bacia",    label: "Por bacia (agregado por ano/mês/bacia)",    hint: "soma das métricas por (ano, mês, bacia)" },
  { value: "operador", label: "Por operador (agregado por ano/mês/operador)", hint: "soma das métricas por (ano, mês, operador)" },
  { value: "ambiente", label: "Por ambiente (agregado por ano/mês/ambiente)",  hint: "soma das métricas por (ano, mês, ambiente)" },
  { value: "estado",   label: "Por estado (agregado por ano/mês/estado)",  hint: "soma das métricas por (ano, mês, estado)" },
  { value: "ano_mes",  label: "Por ano/mês (total agregado)",              hint: "soma total das métricas por mês (≤252 linhas)" },
];

// Hardcoded estimate of aggregated row counts (no extra round-trip). The raw
// path uses `getAnpCdpExportCount`; aggregated paths return one of these
// constants from the modal's `countFetcher`. Numbers are upper-bound back-of-
// envelope: 21 years × 12 months = 252 (ano_mes), then × distinct dimension.
const ANP_CDP_AGG_ESTIMATE: Record<Exclude<AnpCdpGranularity, "raw">, number> = {
  ano_mes:  252,
  estado:   252 * 6,    // ~6 estados produtores (RJ, SP, ES, RN, BA, AM, ...)
  ambiente: 252 * 3,    // PreSal | PosSal | Terra
  bacia:    252 * 12,   // ~12 bacias com produção declarada
  operador: 252 * 30,   // ~30 operadores ativos
  campo:    252 * 50,   // ~50 campos com produção
};

// ── Constants ─────────────────────────────────────────────────────────────────

const METRICS = [
  { key: "petroleo_bbl_dia",             label: "Petróleo (bbl/dia)" },
  { key: "oleo_bbl_dia",                 label: "Óleo (bbl/dia)" },
  { key: "condensado_bbl_dia",           label: "Condensado (bbl/dia)" },
  { key: "gas_total_mm3_dia",            label: "Gás Total (Mm³/dia)" },
  { key: "gas_natural_assoc_mm3_dia",    label: "Gás Assoc. (Mm³/dia)" },
  { key: "gas_natural_n_assoc_mm3_dia",  label: "Gás N-Assoc. (Mm³/dia)" },
  { key: "gas_royalties",                label: "Gás Royalties (Mm³/dia)" },
  { key: "agua_bbl_dia",                 label: "Água (bbl/dia)" },
  { key: "tempo_prod_hs_mes",            label: "Tempo Produção (hs/mês)" },
];

const LOCAL_LABELS: Record<string, string> = {
  PreSal: "Pré-Sal",
  PosSal: "Pós-Sal (Mar)",
  Terra:  "Terra",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildChart(
  serie: AnpCdpSeriePonto[],
  metricKey: string,
  metricLabel: string,
  nPocos: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!serie.length) return emptyPlot(340, "Sem dados.");
  const titleText = nPocos === 0
    ? "Todos os poços"
    : `${nPocos.toLocaleString("pt-BR")} poço${nPocos !== 1 ? "s" : ""} selecionado${nPocos !== 1 ? "s" : ""}`;
  return {
    data: [{
      type: "scatter", mode: "lines",
      name: metricLabel,
      x: serie.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}-01`),
      y: serie.map(r => r[metricKey as keyof AnpCdpSeriePonto] as number),
      line: { width: 2.5, color: "#FF5000" },
      hovertemplate: `%{x|%b %Y}: %{y:,.1f}<extra></extra>`,
      fill: "tozeroy",
      fillcolor: "rgba(255,80,0,0.07)",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT, height: 340,
      margin: { t: 30, b: 50, l: 90, r: 30 },
      title: {
        text: titleText,
        font: { size: 12, color: "#888", family: "Arial" },
        x: 0.01, xanchor: "left",
      },
      yaxis: { ...AXIS_LINE, title: { text: metricLabel } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
    },
  };
}

// ── Reusable components scoped to this page ───────────────────────────────────

// Inverted-toggle checkbox group: empty selection = "all selected".
// Used for Ambiente and Bacia, where the user typically wants everything
// included by default but can untick a few.
function InvertedCheckboxGroup({
  id, items, selected, onChange, labelMap,
}: {
  id: string;
  items: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  labelMap?: Record<string, string>;
}) {
  const toggle = (item: string) => {
    if (selected.length === 0) {
      onChange(items.filter(x => x !== item));
    } else {
      const next = selected.includes(item)
        ? (selected.length > 1 ? selected.filter(x => x !== item) : selected)
        : [...selected, item];
      onChange(next);
    }
  };
  return (
    <>
      {items.map(item => (
        <div key={item} className="form-check" style={{ marginBottom: 4 }}>
          <input className="form-check-input" type="checkbox" id={`${id}-${item}`}
            checked={selected.length === 0 || selected.includes(item)}
            onChange={() => toggle(item)} />
          <label className="form-check-label" htmlFor={`${id}-${item}`}
            style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
            {labelMap?.[item] ?? item}
          </label>
        </div>
      ))}
      {selected.length > 0 && (
        <button className="filter-btn-link filter-btn-link--secondary"
          style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
          onClick={() => onChange([])}>
          Limpar
        </button>
      )}
    </>
  );
}

function MultiFilter({
  label, options, value, onChange, loading,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
}) {
  if (!options.length) return null;
  return (
    <div className="sidebar-filter-section">
      <div className="sidebar-filter-label">
        {label}{" "}
        <span style={{ color: "#888", fontWeight: 400 }}>
          ({value.length === 0 ? options.length : value.length}/{options.length})
        </span>
      </div>
      {!loading && (
        <SearchableMultiSelect options={options} value={value} onChange={onChange} />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp");
  const supabase = getSupabaseClient();

  const [loading, setLoading]           = useState(true);
  const [filtros, setFiltros]           = useState<AnpCdpFiltros>({
    bacoes: [], campos: [], locais: [], estados: [], operadores: [],
    instalacoes: [], tipos_instalacao: [], ano_min: null, ano_max: null,
  });
  // All wells loaded once via JSON RPC — filtered client-side
  const [allPocos, setAllPocos]         = useState<AnpCdpPocoSimples[]>([]);
  const [pocosReady, setPocosReady]     = useState(false);
  const [serieData, setSerieData]       = useState<AnpCdpSeriePonto[]>([]);
  const [allYears, setAllYears]         = useState<number[]>([]);
  const [yearRange, setYearRange]       = useState<[number, number]>([0, 0]);

  // Filters
  const [selectedPocos,       setSelectedPocos]       = useState<string[]>([]);
  const [selectedCampos,      setSelectedCampos]      = useState<string[]>([]);
  const [selectedBacoes,      setSelectedBacoes]      = useState<string[]>([]);
  const [selectedLocais,      setSelectedLocais]      = useState<string[]>([]);
  const [selectedEstados,     setSelectedEstados]     = useState<string[]>([]);
  const [selectedOperadores,  setSelectedOperadores]  = useState<string[]>([]);
  const [selectedInstalacoes, setSelectedInstalacoes] = useState<string[]>([]);
  const [selectedTipos,       setSelectedTipos]       = useState<string[]>([]);
  const [metric, setMetric]             = useState(METRICS[0]);

  // ── Export modal state (Fase B Tier 2) ────────────────────────────────────
  const [exportOpen, setExportOpen]                 = useState(false);
  const [excelLoading, setExcelLoading]             = useState(false);
  const [csvLoading, setCsvLoading]                 = useState(false);
  const [exportBacoes, setExportBacoes]             = useState<string[]>([]);
  const [exportOperadores, setExportOperadores]     = useState<string[]>([]);
  const [exportLocais, setExportLocais]             = useState<string[]>([]);
  const [exportTipos, setExportTipos]               = useState<string[]>([]);
  const [exportRange, setExportRange]               = useState<[number, number]>([0, 0]);
  // Default = raw (1 row per poço × mês × demais dimensões). Aggregated is
  // an explicit opt-in (users picking any aggregated granularity get the
  // dynamic-aggregator RPC; "Por ano/mês" is the smallest summary at ≤252 rows).
  const [exportGranularity, setExportGranularity]   = useState<AnpCdpGranularity>("raw");
  const [exportRawCount, setExportRawCount]         = useState<number | null>(null);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      // filtros + serie load together (fast — indexed queries, ~252 rows)
      const [f, serie] = await Promise.all([
        rpcGetAnpCdpFiltros(supabase),
        rpcGetAnpCdpPocoSerie(supabase),
      ]);
      if (cancelled) return;
      setFiltros(f);
      setSerieData(serie);

      const yMin = f.ano_min ?? 2005;
      const yMax = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      setAllYears(years);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 9));
      setYearRange([startIdx, years.length - 1]);
      setLoading(false);

      // Poços JSON: single request, all wells from materialized view (~1–2s, gzipped)
      const pocos = await rpcGetAnpCdpPocosJson(supabase);
      if (!cancelled) {
        setAllPocos(pocos);
        setPocosReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) ────────────────────────────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      return rpcGetAnpCdpPocoSerie(supabase, {
        pocos:           selectedPocos.length       ? selectedPocos       : null,
        campos:          selectedCampos.length      ? selectedCampos      : null,
        bacoes:          selectedBacoes.length      ? selectedBacoes      : null,
        locais:          selectedLocais.length      ? selectedLocais      : null,
        estados:         selectedEstados.length     ? selectedEstados     : null,
        operadores:      selectedOperadores.length  ? selectedOperadores  : null,
        instalacoes:     selectedInstalacoes.length ? selectedInstalacoes : null,
        tiposInstalacao: selectedTipos.length       ? selectedTipos       : null,
        anoInicio:       allYears[yearRange[0]]     ?? null,
        anoFim:          allYears[yearRange[1]]     ?? null,
      });
    },
    [supabase, loading, selectedPocos, selectedCampos, selectedBacoes, selectedLocais,
      selectedEstados, selectedOperadores, selectedInstalacoes, selectedTipos, yearRange, allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieData(refetched);
  }, [refetched]);

  // ── Client-side poço filtering (all filters applied in-memory) ────────────
  const visiblePocos = useMemo(() => {
    let list = allPocos;
    if (selectedCampos.length)     list = list.filter(p => selectedCampos.includes(p.campo));
    if (selectedBacoes.length)     list = list.filter(p => selectedBacoes.includes(p.bacia));
    if (selectedLocais.length)     list = list.filter(p => selectedLocais.includes(p.local));
    if (selectedEstados.length)    list = list.filter(p => !!p.estado   && selectedEstados.includes(p.estado));
    if (selectedOperadores.length) list = list.filter(p => !!p.operador && selectedOperadores.includes(p.operador));
    return list;
  }, [allPocos, selectedCampos, selectedBacoes, selectedLocais, selectedEstados, selectedOperadores]);

  const pocoOptions = useMemo(() => visiblePocos.map(p => p.poco), [visiblePocos]);

  const chart = useMemo(
    () => buildChart(serieData, metric.key, metric.label, selectedPocos.length),
    [serieData, metric, selectedPocos.length],
  );

  // ── Export modal helpers (Fase B Tier 2) ──────────────────────────────────
  function openExportModal() {
    setExportBacoes(selectedBacoes);
    setExportOperadores(selectedOperadores);
    setExportLocais(selectedLocais);
    setExportTipos(selectedTipos);
    setExportRange(yearRange);
    setExportGranularity("raw");
    setExportRawCount(null);
    setExportOpen(true);
  }

  // Hard-limit flags (only meaningful for raw export — the aggregated path
  // is always tiny). When the modal is showing aggregated, we never block.
  const rawOverExcel =
    exportGranularity === "raw" &&
    exportRawCount !== null &&
    exportRawCount > RAW_EXCEL_MAX_ROWS;
  const rawOverAbs =
    exportGranularity === "raw" &&
    exportRawCount !== null &&
    exportRawCount > RAW_ABS_MAX_ROWS;

  const exportFilters = useMemo<AnpCdpExportCountFilters>(() => {
    const yMin = allYears[exportRange[0]] ?? null;
    const yMax = allYears[exportRange[1]] ?? null;
    return {
      bacoes:          exportBacoes.length     ? exportBacoes     : null,
      operadores:      exportOperadores.length ? exportOperadores : null,
      locais:          exportLocais.length     ? exportLocais     : null,
      tiposInstalacao: exportTipos.length      ? exportTipos      : null,
      anoInicio:       yMin,
      anoFim:          yMax,
    };
  }, [exportBacoes, exportOperadores, exportLocais, exportTipos, exportRange, allYears]);

  if (visLoading || !visible) return null;

  const yMin = allYears[yearRange[0]] ?? "—";
  const yMax = allYears[yearRange[1]] ?? "—";
  const allLocais = filtros.locais.length ? filtros.locais : ["PreSal", "PosSal", "Terra"];

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "100%", maxWidth: 300, height: 60, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  border: "2px dashed #ccc", color: "#aaa", fontSize: 18,
                  fontWeight: 700, letterSpacing: 3, marginBottom: 16, borderRadius: 6,
                }}>TBD</div>
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />
              <div className="sidebar-section-label">Filtros</div>

              {/* Métrica */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Métrica</div>
                {METRICS.map(m => (
                  <div key={m.key} className="form-check" style={{ marginBottom: 4 }}>
                    <input className="form-check-input" type="radio" id={`cdp-m-${m.key}`}
                      checked={metric.key === m.key} onChange={() => setMetric(m)} />
                    <label className="form-check-label" htmlFor={`cdp-m-${m.key}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      {m.label}
                    </label>
                  </div>
                ))}
              </div>

              {/* Ambiente — uses inverted toggle (empty = all) */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Ambiente</div>
                <InvertedCheckboxGroup id="cdp-l" items={allLocais} selected={selectedLocais}
                  onChange={setSelectedLocais} labelMap={LOCAL_LABELS} />
              </div>

              {/* Bacia — uses inverted toggle */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Bacia</div>
                <InvertedCheckboxGroup id="cdp-b" items={filtros.bacoes} selected={selectedBacoes}
                  onChange={setSelectedBacoes} />
              </div>

              {/* Estado */}
              <MultiFilter label="Estado" options={filtros.estados}
                value={selectedEstados} onChange={setSelectedEstados} loading={loading} />

              {/* Operador */}
              <MultiFilter label="Operador" options={filtros.operadores}
                value={selectedOperadores} onChange={setSelectedOperadores} loading={loading} />

              {/* Instalação Destino */}
              <MultiFilter label="Instalação Destino" options={filtros.instalacoes}
                value={selectedInstalacoes} onChange={setSelectedInstalacoes} loading={loading} />

              {/* Tipo Instalação */}
              <MultiFilter label="Tipo Instalação" options={filtros.tipos_instalacao}
                value={selectedTipos} onChange={setSelectedTipos} loading={loading} />

              {/* Campo */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Campo{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length === 0 ? filtros.campos.length : selectedCampos.length}/{filtros.campos.length})
                  </span>
                </div>
                {!loading && (
                  <SearchableMultiSelect
                    options={filtros.campos}
                    value={selectedCampos}
                    onChange={v => { setSelectedCampos(v); setSelectedPocos([]); }}
                  />
                )}
              </div>

              {/* Poço — all wells, filtered client-side */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Poço{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    {pocosReady
                      ? `(${selectedPocos.length === 0 ? pocoOptions.length : selectedPocos.length}/${pocoOptions.length})`
                      : "(carregando…)"}
                  </span>
                </div>
                {!loading && pocosReady && (
                  <SearchableMultiSelect
                    options={pocoOptions}
                    value={selectedPocos}
                    onChange={setSelectedPocos}
                  />
                )}
                {!loading && !pocosReady && (
                  <div style={{ fontSize: 10, color: "#aaa", fontFamily: "Arial", paddingTop: 4 }}>
                    Carregando lista de poços…
                  </div>
                )}
              </div>

              {/* Período */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && allYears.length > 0 && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>
            </div>
          </div>

          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP CDP — Produção por Poço"
                sub="Produção mensal declarada à ANP por poço, campo e operador"
                period={allYears.length > 0 ? [yMin, yMax] : null}
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
              ) : (
                <div className="row mb-2">
                  <div className="col-12">
                    <ChartSection
                      title={`Produção Total Selecionada — ${metric.label}`}
                      loading={serieLoading}
                      height={340}
                    >
                      <PlotlyChart data={chart.data} layout={chart.layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%", height: 340 }} />
                    </ChartSection>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exportar — ANP CDP"
        datasetKey="anp_cdp_producao"
        // Re-key by granularity so useExportSize debounces independently for
        // raw vs ano_mes (we feed the modal a different count in each case).
        currentFilters={{ ...exportFilters, _g: exportGranularity }}
        countFetcher={async () => {
          if (!supabase) return 0;
          // For raw granularity the count == raw rows in anp_cdp_producao.
          // For any aggregated granularity the result is groupwise — return
          // a hardcoded conservative upper bound from ANP_CDP_AGG_ESTIMATE so
          // the size strip doesn't flash a misleading 100MB+ figure (the real
          // count would require an extra round-trip we don't want to pay).
          if (exportGranularity !== "raw") {
            // Reset stored raw count so over-limit flags stay false on
            // aggregated paths.
            setExportRawCount(null);
            return ANP_CDP_AGG_ESTIMATE[exportGranularity];
          }
          const c = await getAnpCdpExportCount(supabase, exportFilters);
          setExportRawCount(c);
          return c;
        }}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Gerando Excel..." : "Baixando CSV..."}
        onExportExcel={async () => {
          if (!supabase) return;
          // Hard-limit gating for raw — early-bail before allocating memory.
          if (rawOverAbs) {
            console.warn("ANP CDP raw Excel blocked: rows exceed RAW_ABS_MAX_ROWS");
            return;
          }
          if (rawOverExcel) {
            console.warn("ANP CDP raw Excel blocked: rows exceed RAW_EXCEL_MAX_ROWS — use CSV");
            return;
          }
          setExcelLoading(true);
          try {
            if (exportGranularity === "raw") {
              const rows = await fetchAnpCdpRawFiltered(supabase, exportFilters);
              await downloadAnpCdpRawExcel(rows);
            } else {
              const groupBy = ANP_CDP_GROUPBY_MAP[exportGranularity];
              const rows = await rpcGetAnpCdpAggregated(supabase, exportFilters, groupBy);
              await downloadAnpCdpAggregatedExcel(rows, groupBy);
            }
            setExportOpen(false);
          } catch (e) {
            console.error("ANP CDP Excel export failed", e);
          } finally {
            setExcelLoading(false);
          }
        }}
        onExportCsv={async () => {
          if (!supabase) return;
          if (rawOverAbs) {
            console.warn("ANP CDP raw CSV blocked: rows exceed RAW_ABS_MAX_ROWS");
            return;
          }
          setCsvLoading(true);
          try {
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, "0");
            const mm = String(now.getMonth() + 1).padStart(2, "0");
            const yy = String(now.getFullYear()).slice(-2);

            if (exportGranularity === "raw") {
              const rows = await fetchAnpCdpRawFiltered(supabase, exportFilters);
              downloadCsv({
                rows: rows as unknown as Record<string, unknown>[],
                filename: `anp_cdp_raw_${dd}-${mm}-${yy}`,
              });
            } else {
              const groupBy = ANP_CDP_GROUPBY_MAP[exportGranularity];
              const rows = await rpcGetAnpCdpAggregated(supabase, exportFilters, groupBy);
              // CSV: include only the requested dim columns + metric columns,
              // matching the Excel layout (avoid spurious null columns from
              // the unused dimensions in the row payload).
              const metricKeys = [
                "petroleo_bbl_dia", "oleo_bbl_dia", "condensado_bbl_dia",
                "gas_total_mm3_dia", "gas_natural_assoc_mm3_dia",
                "gas_natural_n_assoc_mm3_dia", "gas_royalties",
                "agua_bbl_dia", "tempo_prod_hs_mes",
              ] as const;
              const wantedCols = [...groupBy, ...metricKeys] as readonly string[];
              const projected = rows.map((r) => {
                const out: Record<string, unknown> = {};
                for (const k of wantedCols) {
                  out[k] = (r as unknown as Record<string, unknown>)[k];
                }
                return out;
              });
              downloadCsv({
                rows: projected,
                filename: `anp_cdp_${exportGranularity}_${dd}-${mm}-${yy}`,
              });
            }
            setExportOpen(false);
          } catch (e) {
            console.error("ANP CDP CSV export failed", e);
          } finally {
            setCsvLoading(false);
          }
        }}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            {/* Granularidade — default "raw" (1 linha por poço × mês) ─────────── */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Granularidade
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {ANP_CDP_GRANULARITY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="form-check" style={{ marginBottom: 0 }}>
                    <input
                      className="form-check-input"
                      type="radio"
                      id={`cdp-export-g-${opt.value}`}
                      name="cdp-export-granularity"
                      checked={exportGranularity === opt.value}
                      onChange={() => setExportGranularity(opt.value)}
                    />
                    <label
                      className="form-check-label"
                      htmlFor={`cdp-export-g-${opt.value}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}
                    >
                      <strong>{opt.label}</strong>
                      <span style={{ color: "#888", marginLeft: 6, fontSize: 11 }}>
                        — {opt.hint}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Hard-limit warnings (raw only) ─────────────────────────────────── */}
            {rawOverAbs && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#7a1a1a",
                  backgroundColor: "#fdecea",
                  border: "1px solid #f5c2bc",
                  borderRadius: 4,
                  padding: "8px 10px",
                  lineHeight: 1.4,
                }}
              >
                Volume muito alto ({(exportRawCount ?? 0).toLocaleString("pt-BR")} linhas).
                Escolha uma <strong>granularidade agregada</strong> (campo, bacia, operador,
                ambiente, estado ou ano/mês) ou aplique mais filtros (bacia, operador, período).
              </div>
            )}
            {!rawOverAbs && rawOverExcel && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#7a4a00",
                  backgroundColor: "#fff3cd",
                  border: "1px solid #ffe69c",
                  borderRadius: 4,
                  padding: "8px 10px",
                  lineHeight: 1.4,
                }}
              >
                Volume alto para Excel ({(exportRawCount ?? 0).toLocaleString("pt-BR")} linhas).
                Recomendamos baixar em <strong>CSV</strong> (mais leve) — Excel pode falhar no
                navegador.
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Período</div>
              {allYears.length > 0 && (
                <PeriodSlider years={allYears} value={exportRange} onChange={setExportRange} />
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Bacias <span style={{ color: "#888", fontWeight: 400 }}>({exportBacoes.length === 0 ? filtros.bacoes.length : exportBacoes.length}/{filtros.bacoes.length})</span>
                </div>
                <SearchableMultiSelect
                  options={filtros.bacoes}
                  value={exportBacoes}
                  onChange={setExportBacoes}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Operadores <span style={{ color: "#888", fontWeight: 400 }}>({exportOperadores.length === 0 ? filtros.operadores.length : exportOperadores.length}/{filtros.operadores.length})</span>
                </div>
                <SearchableMultiSelect
                  options={filtros.operadores}
                  value={exportOperadores}
                  onChange={setExportOperadores}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Ambientes (Locais)
                </div>
                <SearchableMultiSelect
                  options={allLocais}
                  value={exportLocais}
                  onChange={setExportLocais}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Tipo Instalação <span style={{ color: "#888", fontWeight: 400 }}>({exportTipos.length === 0 ? filtros.tipos_instalacao.length : exportTipos.length}/{filtros.tipos_instalacao.length})</span>
                </div>
                <SearchableMultiSelect
                  options={filtros.tipos_instalacao}
                  value={exportTipos}
                  onChange={setExportTipos}
                />
              </div>
            </div>
          </div>
        }
      />
    </div>
  );
}
