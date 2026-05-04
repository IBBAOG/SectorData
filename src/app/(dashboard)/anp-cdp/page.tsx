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
  rpcGetAnpCdpCampoSerie,
  rpcGetAnpCdpCamposList,
  rpcGetAnpCdpFiltros,
  type AnpCdpSeriePonto,
  type AnpCdpCampoMeta,
  type AnpCdpFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const METRICS = [
  { key: "petroleo_bbl_dia",  label: "Petróleo (bbl/dia)" },
  { key: "gas_total_mm3_dia", label: "Gás Natural (Mm³/dia)" },
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
  nCampos: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!serie.length) return emptyPlot(340);
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
        text: `${nCampos === 0 ? "Todos os campos" : `${nCampos} campo${nCampos > 1 ? "s" : ""} selecionado${nCampos > 1 ? "s" : ""}`}`,
        font: { size: 12, color: "#888", family: "Arial" },
        x: 0.01, xanchor: "left",
      },
      yaxis: { ...AXIS_LINE, title: { text: metricLabel } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp");
  const supabase = getSupabaseClient();

  const [loading, setLoading]             = useState(true);
  const [serieLoading, setSerieLoading]   = useState(false);
  const [filtros, setFiltros]             = useState<AnpCdpFiltros>({ bacoes: [], locais: [], ano_min: null, ano_max: null });
  const [camposList, setCamposList]       = useState<AnpCdpCampoMeta[]>([]);
  const [serieData, setSerieData]         = useState<AnpCdpSeriePonto[]>([]);
  const [allYears, setAllYears]           = useState<number[]>([]);
  const [yearRange, setYearRange]         = useState<[number, number]>([0, 0]);

  // Filters ([] = all / no restriction)
  const [selectedCampos, setSelectedCampos] = useState<string[]>([]);
  const [selectedBacoes, setSelectedBacoes] = useState<string[]>([]);
  const [selectedLocais, setSelectedLocais] = useState<string[]>([]);
  const [metric, setMetric]                 = useState(METRICS[0]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [f, campos, serie] = await Promise.all([
        rpcGetAnpCdpFiltros(supabase),
        rpcGetAnpCdpCamposList(supabase),
        rpcGetAnpCdpCampoSerie(supabase),
      ]);
      if (cancelled) return;
      setFiltros(f);
      setCamposList(campos);
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
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) ────────────────────────────────
  const fetchSerie = useCallback(() => {
    if (!supabase || loading) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSerieLoading(true);
      const data = await rpcGetAnpCdpCampoSerie(supabase, {
        campos:    selectedCampos.length  ? selectedCampos  : null,
        bacoes:    selectedBacoes.length  ? selectedBacoes  : null,
        locais:    selectedLocais.length  ? selectedLocais  : null,
        anoInicio: allYears[yearRange[0]] ?? null,
        anoFim:    allYears[yearRange[1]] ?? null,
      });
      setSerieData(data);
      setSerieLoading(false);
    }, 400);
  }, [supabase, loading, selectedCampos, selectedBacoes, selectedLocais, yearRange, allYears]);

  useEffect(() => { fetchSerie(); }, [fetchSerie]);

  // ── Campo list filtered by bacia/local selection ──────────────────────────
  const visibleCampos = useMemo(() => {
    let list = camposList;
    if (selectedBacoes.length) list = list.filter(c => selectedBacoes.includes(c.bacia));
    if (selectedLocais.length) list = list.filter(c => selectedLocais.includes(c.local));
    // Deduplicate campo names (same campo may appear in multiple locais)
    const seen = new Set<string>();
    return list.filter(c => { if (seen.has(c.campo)) return false; seen.add(c.campo); return true; });
  }, [camposList, selectedBacoes, selectedLocais]);

  const campoOptions = useMemo(() => visibleCampos.map(c => c.campo), [visibleCampos]);

  const chart = useMemo(
    () => buildChart(serieData, metric.key, metric.label, selectedCampos.length),
    [serieData, metric, selectedCampos.length],
  );

  if (visLoading || !visible) return null;

  const toggleLocal = (l: string) =>
    setSelectedLocais(prev => prev.includes(l) ? (prev.length > 1 ? prev.filter(x => x !== l) : prev) : [...prev, l]);

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

              {/* Metric */}
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
                {allLocais.map(l => (
                  <div key={l} className="form-check" style={{ marginBottom: 4 }}>
                    <input className="form-check-input" type="checkbox" id={`cdp-l-${l}`}
                      checked={selectedLocais.length === 0 || selectedLocais.includes(l)}
                      onChange={() => {
                        if (selectedLocais.length === 0) {
                          setSelectedLocais(allLocais.filter(x => x !== l));
                        } else {
                          toggleLocal(l);
                        }
                      }} />
                    <label className="form-check-label" htmlFor={`cdp-l-${l}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      {LOCAL_LABELS[l] ?? l}
                    </label>
                  </div>
                ))}
                {selectedLocais.length > 0 && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setSelectedLocais([])}>
                    Todos
                  </button>
                )}
              </div>

              {/* Bacia */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Bacia</div>
                {filtros.bacoes.map(b => (
                  <div key={b} className="form-check" style={{ marginBottom: 4 }}>
                    <input className="form-check-input" type="checkbox" id={`cdp-b-${b}`}
                      checked={selectedBacoes.length === 0 || selectedBacoes.includes(b)}
                      onChange={() => {
                        if (selectedBacoes.length === 0) {
                          setSelectedBacoes(filtros.bacoes.filter(x => x !== b));
                        } else {
                          setSelectedBacoes(prev =>
                            prev.includes(b) ? (prev.length > 1 ? prev.filter(x => x !== b) : prev) : [...prev, b]
                          );
                        }
                      }} />
                    <label className="form-check-label" htmlFor={`cdp-b-${b}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      {b}
                    </label>
                  </div>
                ))}
                {selectedBacoes.length > 0 && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setSelectedBacoes([])}>
                    Todas
                  </button>
                )}
              </div>

              {/* Campo */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Campo{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length === 0 ? campoOptions.length : selectedCampos.length}/{campoOptions.length})
                  </span>
                </div>
                {!loading && (
                  <SearchableMultiSelect
                    options={campoOptions}
                    value={selectedCampos}
                    onChange={setSelectedCampos}
                  />
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
                ANP CDP — Produção por Campo · {metric.label}
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
