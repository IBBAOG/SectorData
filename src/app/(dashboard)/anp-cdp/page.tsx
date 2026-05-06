"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../components/dashboard/ChartSection";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import {
  rpcGetAnpCdpPocoSerie,
  rpcGetAnpCdpPocosJson,
  rpcGetAnpCdpFiltros,
  type AnpCdpSeriePonto,
  type AnpCdpPocoSimples,
  type AnpCdpFiltros,
} from "../../../lib/rpc";

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
              />

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
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
    </div>
  );
}
