"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../components/NavBar";
import PlotlyChart from "../../components/PlotlyChart";
import PeriodSlider from "../../components/PeriodSlider";
import CheckList from "../../components/CheckList";
import RegionStateFilter from "../../components/RegionStateFilter";
import { resolverDatas } from "../../lib/filterUtils";
import { getSupabaseClient } from "../../lib/supabaseClient";
import {
  type SalesFilters,
  type SalesMetricas,
  rpcGetOpcoesFiltros,
  rpcGetMetricas,
  rpcGetQtdPorAgente,
  rpcGetQtdPorAno,
  rpcGetQtdPorMes,
  rpcGetQtdPorProduto,
  rpcGetQtdPorRegiao,
  rpcGetQtdPorUf,
} from "../../lib/rpc";

const ORANGE = "#FF5000";
const _NO_DATA = "No data for the selected filters.";

function emptyPlot(): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [
        {
          text: _NO_DATA,
          xref: "paper",
          yref: "paper",
          showarrow: false,
          font: { size: 13, family: "Arial", color: "#888" },
        },
      ],
      height: 320,
      margin: { t: 20, b: 30, l: 10, r: 10 },
    },
  };
}

function baseAxis() {
  return {
    showgrid: false,
    zeroline: false,
    showline: true,
    linecolor: "#000000",
    linewidth: 1,
    tickfont: { family: "Arial", size: 12, color: "#000000" },
  };
}

function makeCartesianLayout(params: {
  title?: string;
  xTitle?: string;
  yTitle?: string;
  height?: number;
}): Partial<Layout> {
  const { title, xTitle, yTitle, height = 320 } = params;
  const spikeAxis = {
    showspikes: true,
    spikemode: "across" as const,
    spikedash: "solid",
    spikecolor: "#555555",
    spikethickness: 1,
  };
  return {
    title: title ? { text: title, font: { family: "Arial" } } : undefined,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    font: { family: "Arial", color: "#1a1a1a", size: 12 },
    margin: { t: 40, b: 20, l: 10, r: 10 },
    height,
    hoverlabel: {
      bgcolor: "rgba(255, 255, 255, 0.95)",
      bordercolor: "rgba(180, 180, 180, 0.5)",
      font: { family: "Arial", color: "#1a1a1a", size: 12 },
      namelength: -1,
    },
    xaxis: xTitle
      ? { ...baseAxis(), ...spikeAxis, title: { text: xTitle, font: { family: "Arial" } } }
      : { ...baseAxis(), ...spikeAxis },
    yaxis: yTitle ? { ...baseAxis(), title: { text: yTitle, font: { family: "Arial" } } } : { ...baseAxis() },
  };
}

export default function SalesPage() {
  const supabase = getSupabaseClient();

  const SEGMENTOS = useMemo(() => ["B2B", "Retail", "TRR", "Others"], []);

  const [opcoes, setOpcoes] = useState<Record<string, unknown> | null>(null);
  const datas = useMemo(() => resolverDatas(opcoes ?? {}), [opcoes]);

  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);

  const [segSelected, setSegSelected] = useState<string[]>([]);
  const [agentesSelected, setAgentesSelected] = useState<string[]>([]);
  const [regioesSelected, setRegioesSelected] = useState<string[]>([]);
  const [ufsSelected, setUfsSelected] = useState<string[]>([]);

  // When empty object is passed, it behaves like "no filters" (send NULLs in RPC params).
  const [appliedFilters, setAppliedFilters] = useState<SalesFilters>({});

  const [showToast, setShowToast] = useState(false);
  const [chartsLoading, setChartsLoading] = useState(false);

  type AnoRow = { ano: string | number; quantidade: number };
  type MesRow = { mes: string; quantidade: number };
  type RegiaoRow = { regiao: string; quantidade: number };
  type UfRow = { uf: string; quantidade: number };
  type AgenteRow = { agente: string; quantidade: number };
  type ProdutoRow = { produto: string; quantidade: number };

  const [metricas, setMetricas] = useState<SalesMetricas>({
    total_registros: 0,
    quantidade_total: 0,
    anos_distintos: 0,
  });
  const [dfAno, setDfAno] = useState<AnoRow[]>([]);
  const [dfMes, setDfMes] = useState<MesRow[]>([]);
  const [dfRegiao, setDfRegiao] = useState<RegiaoRow[]>([]);
  const [dfUf, setDfUf] = useState<UfRow[]>([]);
  const [dfAgente, setDfAgente] = useState<AgenteRow[]>([]);
  const [dfProduto, setDfProduto] = useState<ProdutoRow[]>([]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const data = await rpcGetOpcoesFiltros(supabase);
      if (!cancelled) setOpcoes(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!datas || datas.length === 0) return;
    setSliderRange([0, datas.length - 1]);
  }, [datas.length]);

  useEffect(() => {
    if (!opcoes) return;
    if (!supabase) return;

    let cancelled = false;
    setChartsLoading(true);

    const safeFilters: SalesFilters = {
      ...appliedFilters,
      segmentos: appliedFilters.segmentos ?? [],
      agentes: appliedFilters.agentes ?? [],
      regioes_dest: appliedFilters.regioes_dest ?? [],
      ufs_dest: appliedFilters.ufs_dest ?? [],
      mercados: appliedFilters.mercados ?? [],
    };

    (async () => {
      try {
        const [
          m,
          ano,
          mes,
          regiao,
          uf,
          agente,
          produto,
        ] = await Promise.all([
          rpcGetMetricas(supabase, safeFilters),
          rpcGetQtdPorAno(supabase, safeFilters),
          rpcGetQtdPorMes(supabase, safeFilters),
          rpcGetQtdPorRegiao(supabase, safeFilters),
          rpcGetQtdPorUf(supabase, safeFilters),
          rpcGetQtdPorAgente(supabase, safeFilters),
          rpcGetQtdPorProduto(supabase, safeFilters),
        ]);

        if (cancelled) return;
        setMetricas(m);
        setDfAno(ano);
        setDfMes(mes);
        setDfRegiao(regiao);
        setDfUf(uf);
        setDfAgente(agente);
        setDfProduto(produto);
      } finally {
        if (!cancelled) setChartsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedFilters, opcoes, supabase]);

  const formattedMetricas = useMemo(() => {
    const totalReg =
      typeof metricas?.total_registros === "number" ? metricas.total_registros : 0;
    const totalVol =
      typeof metricas?.quantidade_total === "number" ? metricas.quantidade_total : 0;
    const anos =
      typeof metricas?.anos_distintos === "number" ? metricas.anos_distintos : 0;

    return {
      totalReg: totalReg.toLocaleString(),
      totalVol: totalVol.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      anos: String(anos),
    };
  }, [metricas]);

  function applyFilters() {
    if (!datas || datas.length === 0) return;
    const [a, b] = sliderRange;
    setAppliedFilters({
      data_inicio: datas[a] ?? null,
      data_fim: datas[b] ?? null,
      segmentos: segSelected ?? [],
      agentes: agentesSelected ?? [],
      regioes_dest: regioesSelected ?? [],
      ufs_dest: ufsSelected ?? [],
      mercados: [],
    });
    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 2500);
  }

  function clearFilters() {
    setAppliedFilters({});
    setSegSelected([]);
    setAgentesSelected([]);
    setRegioesSelected([]);
    setUfsSelected([]);
  }

  const salesCharts = useMemo(() => {
    const hBarLayout = (yTitle: string): Partial<Layout> => ({
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      font: { family: "Arial", size: 12, color: "#000000" },
      margin: { t: 40, b: 20, l: 10, r: 10 },
      height: 320,
      hoverlabel: {
        bgcolor: "rgba(255, 255, 255, 0.95)",
        bordercolor: "rgba(180, 180, 180, 0.5)",
        font: { family: "Arial", color: "#1a1a1a", size: 12 },
        namelength: -1,
      },
      xaxis: {
        title: { text: "Volume (thousand m3)", font: { family: "Arial" } },
        showgrid: false,
        zeroline: false,
        showline: true,
        showspikes: true,
        spikemode: "across" as const,
        spikedash: "solid",
        spikecolor: "#555555",
        spikethickness: 1,
      },
      yaxis: {
        title: { text: yTitle, font: { family: "Arial" } },
        categoryorder: "total ascending",
      },
    } as Partial<Layout>);

    return {
      figAno: dfAno.length ? {
        data: [{ type: "bar", x: dfAno.map((r) => r.ano), y: dfAno.map((r) => r.quantidade), marker: { color: ORANGE } } as PlotData],
        layout: makeCartesianLayout({ title: "Volume by Year", xTitle: "Year", yTitle: "Volume (thousand m3)", height: 320 }),
      } : emptyPlot(),

      figMes: dfMes.length ? {
        data: [{ type: "scatter", mode: "lines+markers", x: dfMes.map((r) => r.mes), y: dfMes.map((r) => r.quantidade), line: { color: ORANGE, width: 2 }, marker: { color: ORANGE, size: 6 } } as PlotData],
        layout: makeCartesianLayout({ title: "Volume by Month", xTitle: "Month", yTitle: "Volume (thousand m3)", height: 320 }),
      } : emptyPlot(),

      figRegiao: dfRegiao.length ? {
        data: [{ type: "pie", labels: dfRegiao.map((r) => r.regiao), values: dfRegiao.map((r) => r.quantidade), textposition: "inside", textinfo: "percent+label", hovertemplate: "%{label}: %{value:,.2f} (%{percent})<extra></extra>" } as unknown as PlotData],
        layout: { paper_bgcolor: "white", plot_bgcolor: "white", font: { family: "Arial", size: 12, color: "#000000" }, margin: { t: 40, b: 20, l: 10, r: 10 }, height: 320 } as Partial<Layout>,
      } : emptyPlot(),

      figUf: dfUf.length ? {
        data: [{ type: "bar", orientation: "h", y: dfUf.map((r) => r.uf), x: dfUf.map((r) => r.quantidade), marker: { color: ORANGE } } as PlotData],
        layout: hBarLayout("State"),
      } : emptyPlot(),

      figAgente: dfAgente.length ? {
        data: [{ type: "bar", orientation: "h", y: dfAgente.map((r) => r.agente), x: dfAgente.map((r) => r.quantidade), marker: { color: ORANGE } } as PlotData],
        layout: hBarLayout("Agent"),
      } : emptyPlot(),

      figProduto: dfProduto.length ? {
        data: [{ type: "bar", orientation: "h", y: dfProduto.map((r) => r.produto), x: dfProduto.map((r) => r.quantidade), marker: { color: ORANGE } } as PlotData],
        layout: hBarLayout("Product"),
      } : emptyPlot(),
    };
  }, [dfAno, dfMes, dfRegiao, dfUf, dfAgente, dfProduto]);

  if (!opcoes) return null;

  return (
    <div>
      <NavBar />

      {showToast ? (
        <div
          id="toast-filters"
          className="alert alert-success"
          role="alert"
          style={{
            fontFamily: "Arial",
            fontSize: 13,
            padding: "10px 14px",
            border: "none",
            boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          }}
        >
          Filters applied!
        </div>
      ) : null}

      <div className="container-fluid g-0">
        <div className="row g-0">
          <div className="col-2 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <img
                  src="/logo.png"
                  alt="Itaú BBA"
                  style={{ width: "100%", maxWidth: 300, marginBottom: 16 }}
                />
              </div>

              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                <PeriodSlider
                  datas={datas}
                  value={sliderRange}
                  onChange={setSliderRange}
                  sliderId="sales-slider-period"
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Segment</div>
                <CheckList label="Segment" options={SEGMENTOS} value={segSelected} onChange={setSegSelected} />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Regulated Agent</div>
                <CheckList
                  label="Regulated Agent"
                  options={(opcoes?.agentes ?? []) as string[]}
                  value={agentesSelected}
                  onChange={setAgentesSelected}
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Region / State</div>
                <RegionStateFilter
                  regioes={(opcoes?.regioes_dest ?? []) as string[]}
                  ufs={(opcoes?.ufs_dest ?? []) as string[]}
                  selectedRegioes={regioesSelected}
                  selectedUfs={ufsSelected}
                  onRegioesChange={setRegioesSelected}
                  onUfsChange={setUfsSelected}
                />
              </div>

              <div className="row g-1 mt-1">
                <div className="col-6">
                  <button type="button" className="btn btn-apply" onClick={applyFilters}>
                    Apply
                  </button>
                </div>
                <div className="col-6">
                  <button type="button" className="btn btn-clear" onClick={clearFilters}>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="col-10">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">Sales Dashboard</div>
                <div className="page-header-sub">Product volume analysis (thousand m³)</div>
              </div>

              <div className="row mb-3 g-3">
                <div className="col-md-4">
                  <div className="metric-card">
                    <div className="metric-label">Total Records</div>
                    <div className="metric-value">{formattedMetricas.totalReg}</div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="metric-card">
                    <div className="metric-label">Total Volume (thousand m³)</div>
                    <div className="metric-value">{formattedMetricas.totalVol}</div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="metric-card">
                    <div className="metric-label">Available Years</div>
                    <div className="metric-value">{formattedMetricas.anos}</div>
                  </div>
                </div>
              </div>

              <hr style={{ borderTop: "2px solid #e0e0e0", marginBottom: 12 }} />

              {chartsLoading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
              ) : (
                <>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <PlotlyChart
                          data={salesCharts.figAno.data}
                          layout={salesCharts.figAno.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <PlotlyChart
                          data={salesCharts.figMes.data}
                          layout={salesCharts.figMes.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <PlotlyChart
                          data={salesCharts.figRegiao.data}
                          layout={salesCharts.figRegiao.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <PlotlyChart
                          data={salesCharts.figUf.data}
                          layout={salesCharts.figUf.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <PlotlyChart
                          data={salesCharts.figAgente.data}
                          layout={salesCharts.figAgente.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <PlotlyChart
                          data={salesCharts.figProduto.data}
                          layout={salesCharts.figProduto.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

