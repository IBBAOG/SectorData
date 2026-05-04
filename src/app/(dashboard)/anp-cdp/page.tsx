"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout, PlotData } from "plotly.js";
import Slider from "rc-slider";
import "rc-slider/assets/index.css";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  rpcGetAnpCdpPocoSerie,
  rpcGetAnpCdpPocosList,
  rpcGetAnpCdpFiltros,
  type AnpCdpSeriePonto,
  type AnpCdpPocoMeta,
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

const COMMON_LAYOUT: Partial<Layout> = {
  paper_bgcolor: "white",
  plot_bgcolor:  "white",
  font: { family: "Arial", size: 12, color: "#000000" },
  hoverlabel: {
    bgcolor:     "rgba(255,255,255,0.95)",
    bordercolor: "rgba(180,180,180,0.5)",
    font: { family: "Arial", color: "#1a1a1a", size: 12 },
    namelength: -1,
  },
};
const AXIS_LINE = { showgrid: false, zeroline: false, showline: true, linecolor: "#000000", linewidth: 1 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function emptyPlot(h = 340): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      ...COMMON_LAYOUT, height: h, margin: { t: 20, b: 30, l: 10, r: 10 },
      annotations: [{ text: "Sem dados.", xref: "paper", yref: "paper", showarrow: false, font: { size: 13, color: "#888" } }],
    },
  };
}

function buildChart(
  serie: AnpCdpSeriePonto[],
  metricKey: string,
  metricLabel: string,
  nPocos: number,
  totalPocos: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!serie.length) return emptyPlot(340);
  const allSelected = nPocos === 0;
  const titleText = allSelected
    ? `Todos os poços (${totalPocos.toLocaleString("pt-BR")})`
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

// ── Small reusable filter components ─────────────────────────────────────────

function CheckboxGroup({
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
          Todos
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

  const [loading, setLoading]         = useState(true);
  const [serieLoading, setSerieLoading] = useState(false);
  const [filtros, setFiltros]         = useState<AnpCdpFiltros>({
    bacoes: [], campos: [], locais: [], estados: [], operadores: [],
    instalacoes: [], tipos_instalacao: [], ano_min: null, ano_max: null,
  });
  const [pocosList, setPocosList]     = useState<AnpCdpPocoMeta[]>([]);
  const [pocosLoaded, setPocosLoaded] = useState(false);
  const [serieData, setSerieData]     = useState<AnpCdpSeriePonto[]>([]);
  const [allYears, setAllYears]       = useState<number[]>([]);
  const [yearRange, setYearRange]     = useState<[number, number]>([0, 0]);

  // Filters ([] = all / no restriction)
  const [selectedPocos,          setSelectedPocos]          = useState<string[]>([]);
  const [selectedCampos,         setSelectedCampos]         = useState<string[]>([]);
  const [selectedBacoes,         setSelectedBacoes]         = useState<string[]>([]);
  const [selectedLocais,         setSelectedLocais]         = useState<string[]>([]);
  const [selectedEstados,        setSelectedEstados]        = useState<string[]>([]);
  const [selectedOperadores,     setSelectedOperadores]     = useState<string[]>([]);
  const [selectedInstalacoes,    setSelectedInstalacoes]    = useState<string[]>([]);
  const [selectedTipos,          setSelectedTipos]          = useState<string[]>([]);
  const [metric, setMetric]           = useState(METRICS[0]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
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
      const currentYear = new Date().getFullYear();
      const startIdx = Math.max(0, years.findIndex(y => y >= currentYear - 9));
      setYearRange([startIdx, years.length - 1]);
      setLoading(false);

      // Load poços list in background (24K rows — doesn't block UI)
      const pocos = await rpcGetAnpCdpPocosList(supabase);
      if (!cancelled) {
        setPocosList(pocos);
        setPocosLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) ────────────────────────────────
  const fetchSerie = useCallback(() => {
    if (!supabase || loading) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSerieLoading(true);
      const data = await rpcGetAnpCdpPocoSerie(supabase, {
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
      setSerieData(data);
      setSerieLoading(false);
    }, 400);
  }, [supabase, loading, selectedPocos, selectedCampos, selectedBacoes, selectedLocais,
      selectedEstados, selectedOperadores, selectedInstalacoes, selectedTipos, yearRange, allYears]);

  useEffect(() => { fetchSerie(); }, [fetchSerie]);

  // ── Derived options (narrowed by upstream filters) ────────────────────────

  // Campo: from filtros (fast), narrowed by bacia/local/estado via pocosList when loaded
  const visibleCampos = useMemo(() => {
    const needsNarrow = selectedBacoes.length || selectedLocais.length || selectedEstados.length;
    if (!needsNarrow || !pocosLoaded) return filtros.campos;
    const seen = new Set<string>();
    pocosList
      .filter(p =>
        (!selectedBacoes.length  || selectedBacoes.includes(p.bacia))  &&
        (!selectedLocais.length  || selectedLocais.includes(p.local))  &&
        (!selectedEstados.length || (p.estado && selectedEstados.includes(p.estado)))
      )
      .forEach(p => seen.add(p.campo));
    return filtros.campos.filter(c => seen.has(c));
  }, [filtros.campos, pocosList, pocosLoaded, selectedBacoes, selectedLocais, selectedEstados]);

  // Poço: filtered by all active dimension filters
  const visiblePocos = useMemo(() => {
    let list = pocosList;
    if (selectedCampos.length)      list = list.filter(p => selectedCampos.includes(p.campo));
    if (selectedBacoes.length)      list = list.filter(p => selectedBacoes.includes(p.bacia));
    if (selectedLocais.length)      list = list.filter(p => selectedLocais.includes(p.local));
    if (selectedEstados.length)     list = list.filter(p => p.estado     && selectedEstados.includes(p.estado));
    if (selectedOperadores.length)  list = list.filter(p => p.operador   && selectedOperadores.includes(p.operador));
    if (selectedInstalacoes.length) list = list.filter(p => p.instalacao_destino && selectedInstalacoes.includes(p.instalacao_destino));
    if (selectedTipos.length)       list = list.filter(p => p.tipo_instalacao    && selectedTipos.includes(p.tipo_instalacao));
    return list;
  }, [pocosList, selectedCampos, selectedBacoes, selectedLocais, selectedEstados,
      selectedOperadores, selectedInstalacoes, selectedTipos]);

  const pocoOptions = useMemo(() => visiblePocos.map(p => p.poco), [visiblePocos]);

  const chart = useMemo(
    () => buildChart(serieData, metric.key, metric.label, selectedPocos.length, pocosList.length),
    [serieData, metric, selectedPocos.length, pocosList.length],
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

              {/* Ambiente */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Ambiente</div>
                <CheckboxGroup
                  id="cdp-l"
                  items={allLocais}
                  selected={selectedLocais}
                  onChange={setSelectedLocais}
                  labelMap={LOCAL_LABELS}
                />
              </div>

              {/* Bacia */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Bacia</div>
                <CheckboxGroup
                  id="cdp-b"
                  items={filtros.bacoes}
                  selected={selectedBacoes}
                  onChange={setSelectedBacoes}
                />
              </div>

              {/* Estado */}
              <MultiFilter
                label="Estado" options={filtros.estados}
                value={selectedEstados} onChange={setSelectedEstados} loading={loading}
              />

              {/* Operador */}
              <MultiFilter
                label="Operador" options={filtros.operadores}
                value={selectedOperadores} onChange={setSelectedOperadores} loading={loading}
              />

              {/* Instalação Destino */}
              <MultiFilter
                label="Instalação Destino" options={filtros.instalacoes}
                value={selectedInstalacoes} onChange={setSelectedInstalacoes} loading={loading}
              />

              {/* Tipo Instalação */}
              <MultiFilter
                label="Tipo Instalação" options={filtros.tipos_instalacao}
                value={selectedTipos} onChange={setSelectedTipos} loading={loading}
              />

              {/* Campo */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Campo{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length === 0 ? visibleCampos.length : selectedCampos.length}/{visibleCampos.length})
                  </span>
                </div>
                {!loading && (
                  <SearchableMultiSelect
                    options={visibleCampos}
                    value={selectedCampos}
                    onChange={v => { setSelectedCampos(v); setSelectedPocos([]); }}
                  />
                )}
              </div>

              {/* Poço */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Poço{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    {pocosLoaded
                      ? `(${selectedPocos.length === 0 ? pocoOptions.length : selectedPocos.length}/${pocoOptions.length})`
                      : "(carregando…)"}
                  </span>
                </div>
                {!loading && pocosLoaded && (
                  <SearchableMultiSelect
                    options={pocoOptions}
                    value={selectedPocos}
                    onChange={setSelectedPocos}
                  />
                )}
                {!loading && !pocosLoaded && (
                  <div style={{ fontSize: 10, color: "#aaa", fontFamily: "Arial", paddingTop: 4 }}>
                    Aguardando lista de poços…
                  </div>
                )}
              </div>

              {/* Período */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && allYears.length > 0 && (
                  <>
                    <div style={{ marginTop: 18, marginBottom: 10, paddingLeft: 4, paddingRight: 4 }}>
                      <Slider range min={0} max={allYears.length - 1} value={yearRange}
                        onChange={v => { const a = v as number[]; setYearRange([a[0], a[1]]); }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", fontFamily: "Arial" }}>
                      <span style={{ fontWeight: 600 }}>{yMin}</span>
                      <span style={{ fontWeight: 600 }}>{yMax}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="page-header-title" style={{ marginBottom: 16 }}>
                ANP CDP — Produção por Poço · {metric.label}
                {yMin && yMax ? ` · ${yMin}–${yMax}` : ""}
              </div>

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
              ) : (
                <div className="row mb-2">
                  <div className="col-12">
                    <div className="chart-container" style={{ position: "relative" }}>
                      <div className="section-title">
                        Produção Total Selecionada — {metric.label}
                        {serieLoading && (
                          <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                            atualizando…
                          </span>
                        )}
                      </div>
                      <hr className="section-hr" />
                      <PlotlyChart data={chart.data} layout={chart.layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%", height: 340, opacity: serieLoading ? 0.5 : 1 }} />
                    </div>
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
