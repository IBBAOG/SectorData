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
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import {
  rpcGetAnpLpcNacional,
  rpcGetAnpLpcSerie,
  rpcGetAnpLpcFiltros,
  type AnpLpcNacionalRow,
  type AnpLpcSerieRow,
  type AnpLpcFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUTO_COLORS: Record<string, string> = {
  "GASOLINA COMUM":      "#FF5000",
  "GASOLINA ADITIVADA":  "#FF8C42",
  "ETANOL HIDRATADO":    "#8BC34A",
  "DIESEL S10":          "#2196F3",
  "DIESEL S500":         "#64B5F6",
  "GNV":                 "#9C27B0",
  "GLP":                 "#FF9800",
};
const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
];

const UF_REGIAO: Record<string, string> = {
  AC: "N",  AM: "N",  AP: "N",  PA: "N",  RO: "N",  RR: "N",  TO: "N",
  AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE",
  DF: "CO", GO: "CO", MS: "CO", MT: "CO",
  ES: "SE", MG: "SE", RJ: "SE", SP: "SE",
  PR: "S",  RS: "S",  SC: "S",
};

const REGIAO_COLORS: Record<string, string> = {
  N: "#009688", NE: "#FF5722", CO: "#9C27B0", SE: "#F44336", S: "#3F51B5",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildNacionalChart(
  rows: AnpLpcNacionalRow[],
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => produtos.includes(r.produto));
  if (!filtered.length) return emptyPlot(320);

  const byProduto: Record<string, AnpLpcNacionalRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter(p => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
      const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
      return {
        type: "scatter", mode: "lines",
        name: p,
        x: data.map(r => r.data_fim),
        y: data.map(r => r.preco_medio_venda),
        line: { width: 2, color },
        hovertemplate: `${p}: R$ %{y:.3f}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      margin: { t: 10, b: 50, l: 75, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L (ou kg)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildRegiaoChart(
  rows: AnpLpcSerieRow[],
  produto: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r.produto === produto);
  if (!filtered.length) return emptyPlot(280);

  // Aggregate by regiao (avg across UFs per week)
  const regiaoTotals: Record<string, Record<string, { sum: number; cnt: number }>> = {};
  for (const r of filtered) {
    const reg = UF_REGIAO[r.estado] ?? r.estado;
    if (!regiaoTotals[reg]) regiaoTotals[reg] = {};
    if (!regiaoTotals[reg][r.data_fim]) regiaoTotals[reg][r.data_fim] = { sum: 0, cnt: 0 };
    regiaoTotals[reg][r.data_fim].sum += r.preco_medio_venda ?? 0;
    regiaoTotals[reg][r.data_fim].cnt += 1;
  }

  const regioes = Object.keys(regiaoTotals).sort();
  const traces: PlotData[] = regioes.map(reg => {
    const entries = Object.entries(regiaoTotals[reg])
      .sort(([a], [b]) => a.localeCompare(b));
    return {
      type: "scatter", mode: "lines",
      name: reg,
      x: entries.map(([d]) => d),
      y: entries.map(([, v]) => v.sum / v.cnt),
      line: { width: 1.5, color: REGIAO_COLORS[reg] ?? "#999" },
      hovertemplate: `${reg}: R$ %{y:.3f}<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 10, b: 50, l: 75, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpLpcPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-lpc");
  const supabase = getSupabaseClient();

  const [loading, setLoading]                 = useState(true);
  const [filtros, setFiltros]                 = useState<AnpLpcFiltros>({
    produtos: [], estados: [], data_min: null, data_max: null,
  });
  const [nacionalRows, setNacionalRows]       = useState<AnpLpcNacionalRow[]>([]);
  const [estadoRows, setEstadoRows]           = useState<AnpLpcSerieRow[]>([]);
  const [allYears, setAllYears]               = useState<number[]>([]);
  const [yearRange, setYearRange]             = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);
  const [detailProduto, setDetailProduto]     = useState<string>("");

  // ── Initial load: filtros + first fetches ────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpLpcFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);
      setSelectedProdutos(f.produtos);
      setDetailProduto(f.produtos[0] ?? "");

      const yMin = f.data_min ? parseInt(f.data_min.slice(0, 4)) : new Date().getFullYear() - 5;
      const yMax = f.data_max ? parseInt(f.data_max.slice(0, 4)) : new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 4));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      const dataInicio = `${fromYear}-01-01`;
      const dataFim    = `${yMax}-12-31`;

      const [nacional, estado] = await Promise.all([
        rpcGetAnpLpcNacional(supabase, { dataInicio, dataFim }),
        rpcGetAnpLpcSerie(supabase,    { dataInicio, dataFim }),
      ]);

      if (!cancelled) {
        setNacionalRows(nacional);
        setEstadoRows(estado);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive refetch (debounced 400ms) — period changes only ─────────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      const dataInicio = yMin ? `${yMin}-01-01` : null;
      const dataFim    = yMax ? `${yMax}-12-31` : null;
      const [nacional, estado] = await Promise.all([
        rpcGetAnpLpcNacional(supabase, { dataInicio, dataFim }),
        rpcGetAnpLpcSerie(supabase,    { dataInicio, dataFim }),
      ]);
      return { nacional, estado };
    },
    [supabase, loading, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) {
      setNacionalRows(refetched.nacional);
      setEstadoRows(refetched.estado);
    }
  }, [refetched]);

  const nacChart = useMemo(
    () => buildNacionalChart(nacionalRows, selectedProdutos),
    [nacionalRows, selectedProdutos],
  );

  const regChart = useMemo(
    () => buildRegiaoChart(estadoRows, detailProduto),
    [estadoRows, detailProduto],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelectedProdutos(prev =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter(x => x !== p) : prev
        : [...prev, p]
    );

  const hasYears = allYears.length > 0;
  const yMin = hasYears ? allYears[yearRange[0]] : null;
  const yMax = hasYears ? allYears[yearRange[1]] : null;

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

              <div className="sidebar-section-label">Filtros</div>

              <MultiSelectFilter
                label="Produto"
                items={filtros.produtos}
                selected={selectedProdutos}
                onToggle={toggleProduto}
                onClear={selectedProdutos.length < filtros.produtos.length ? () => setSelectedProdutos(filtros.produtos) : undefined}
                swatch={(p) => {
                  const i = filtros.produtos.indexOf(p);
                  return PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
                }}
                idPrefix="lpc"
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasYears && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Detalhe por Região — Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={detailProduto}
                  onChange={e => setDetailProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {filtros.produtos.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP LPC — Levantamento de Preços de Combustíveis"
                sub="Preço médio semanal nos postos por produto e UF (média ponderada por número de postos pesquisados)"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
              />

              {loading ? (
                <BarrelLoading />
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title="Preço Médio Nacional — Venda (R$/L ou R$/kg)"
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={nacChart.data}
                          layout={nacChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Preço por Região — ${detailProduto}`}
                        loading={serieLoading}
                        height={280}
                      >
                        <PlotlyChart
                          data={regChart.data}
                          layout={regChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
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
