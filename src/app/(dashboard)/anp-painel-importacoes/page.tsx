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
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../lib/plotlyDefaults";
import { m3ToMilM3, LABEL } from "../../../lib/units";
import {
  rpcGetAnpPainelImpSerie,
  rpcGetAnpPainelImpTopDist,
  rpcGetAnpPainelImpFiltros,
  type AnpPainelImpSerieRow,
  type AnpPainelImpTopDistRow,
  type AnpPainelImpFiltros,
} from "../../../lib/rpc";

// ── Helpers ────────────────────────────────────────────────────────────────────

// volume_m3 → mil m³: m3 / 1e3 = thousands of cubic meters.
// Source pipeline: scraper reads "Quantidade (mil m³)" * 1000 → stores as m³.
// Math: 1 mil m³ = 1.000 m³. Divisor 1e3 matches label "mil m³".
function buildSerieChart(
  rows: AnpPainelImpSerieRow[],
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  // Server already filtered by period (and optionally produtos/UFs).
  const filtered = rows.filter(r => produtos.includes(r.nome_produto));
  if (!filtered.length) return emptyPlot(300);

  const byProduto: Record<string, AnpPainelImpSerieRow[]> = {};
  for (const r of filtered) (byProduto[r.nome_produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter(p => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort(
        (a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
      );
      return {
        type: "scatter", mode: "lines",
        name: p,
        x: data.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
        y: data.map(r => m3ToMilM3(r.volume_m3 ?? 0)),
        line: { width: 2, color: PALETTE[i % PALETTE.length] },
        hovertemplate: `${p}: %{y:.1f} ${LABEL.MIL_M3}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 300,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${LABEL.MIL_M3} / mês` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0, font: { size: 10 } },
    },
  };
}

function buildTopDistChart(
  rows: AnpPainelImpTopDistRow[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(420);
  const sorted = [...rows].sort((a, b) => (b.total_m3 ?? 0) - (a.total_m3 ?? 0));
  return {
    data: [{
      type: "bar", orientation: "h",
      x: sorted.map(r => m3ToMilM3(r.total_m3 ?? 0)),
      y: sorted.map(r => r.distribuidor),
      marker: { color: "#1E88E5" },
      hovertemplate: `%{y}: %{x:.1f} ${LABEL.MIL_M3}<extra></extra>`,
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT, height: 420,
      margin: { t: 10, b: 40, l: 200, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: LABEL.MIL_M3 } },
      yaxis: { autorange: "reversed" as const, showgrid: false, zeroline: false, tickfont: { size: 10 } },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpPainelImportacoesPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-painel-importacoes");
  const supabase = getSupabaseClient();

  const [loading, setLoading]               = useState(true);
  const [filtros, setFiltros]               = useState<AnpPainelImpFiltros>({
    produtos: [], ufs: [], distribuidores: [], ano_min: null, ano_max: null,
  });
  const [serieRows, setSerieRows]           = useState<AnpPainelImpSerieRow[]>([]);
  const [allYears, setAllYears]             = useState<number[]>([]);
  const [yearRange, setYearRange]           = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelectedProd] = useState<string[]>([]);
  const [topProduto, setTopProduto]         = useState<string>("");
  const [topRows, setTopRows]               = useState<AnpPainelImpTopDistRow[]>([]);

  // ── Initial load: filtros + first serie fetch (last 10 years) ──────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpPainelImpFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);

      const yMin = f.ano_min ?? new Date().getFullYear() - 10;
      const yMax = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 9));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      // Empty table guard
      if (!years.length || !f.produtos.length) {
        if (!cancelled) {
          setSerieRows([]);
          setLoading(false);
        }
        return;
      }

      // Fetch serie for the visible window (server-side period filter)
      const rows = await rpcGetAnpPainelImpSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMax,
      });
      if (cancelled) return;

      // Default selection: all products (small count) for the line chart;
      // top dropdown defaults to product with largest volume in window.
      const prodVols: Record<string, number> = {};
      for (const r of rows) prodVols[r.nome_produto] = (prodVols[r.nome_produto] ?? 0) + (r.volume_m3 ?? 0);
      const sortedByVol = Object.entries(prodVols).sort((a, b) => b[1] - a[1]).map(([k]) => k);
      setSelectedProd(f.produtos);
      setTopProduto(sortedByVol[0] ?? f.produtos[0] ?? "");
      setSerieRows(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const { data: refetchedSerie, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      return rpcGetAnpPainelImpSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
    },
    [supabase, loading, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetchedSerie) setSerieRows(refetchedSerie);
  }, [refetchedSerie]);

  // ── Top distribuidores: refetch on topProduto or period change ────────────
  const { data: refetchedTop, loading: topLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || !topProduto || allYears.length === 0 || loading) return null;
      return rpcGetAnpPainelImpTopDist(
        supabase, topProduto,
        allYears[yearRange[0]] ?? null,
        allYears[yearRange[1]] ?? null,
      );
    },
    [supabase, topProduto, yearRange[0], yearRange[1], allYears, loading],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (refetchedTop) setTopRows(refetchedTop);
  }, [refetchedTop]);

  const serieChart = useMemo(
    () => buildSerieChart(serieRows, selectedProdutos),
    [serieRows, selectedProdutos],
  );

  const topChart = useMemo(
    () => buildTopDistChart(topRows),
    [topRows],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelectedProd(prev =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter(x => x !== p) : prev
        : [...prev, p]
    );

  const hasYears = allYears.length > 0;
  const hasData  = filtros.produtos.length > 0;
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
                label="Produto (Série)"
                items={filtros.produtos}
                selected={selectedProdutos}
                onToggle={toggleProduto}
                onClear={filtros.produtos.length > 0 && selectedProdutos.length < filtros.produtos.length
                  ? () => setSelectedProd(filtros.produtos)
                  : undefined}
                swatch={(p) => {
                  const i = filtros.produtos.indexOf(p);
                  return PALETTE[i % PALETTE.length];
                }}
                idPrefix="pimp"
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasYears && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Top Distribuidores — Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={topProduto}
                  onChange={e => setTopProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 11 }}
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
                title="ANP Painel — Importações de Distribuidores"
                sub={`Volumes mensais importados por distribuidor, UF e produto (volume em ${LABEL.MIL_M3})`}
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
              />

              {loading ? (
                <BarrelLoading />
              ) : !hasData ? (
                <div className="d-flex justify-content-center align-items-center my-5"
                  style={{ minHeight: 240, color: "#888", fontFamily: "Arial", fontSize: 14 }}>
                  Sem dados disponíveis para este módulo no momento.
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Volume Mensal Importado por Produto — Total Nacional (${LABEL.MIL_M3} / mês)`}
                        loading={serieLoading}
                        height={300}
                      >
                        <PlotlyChart
                          data={serieChart.data}
                          layout={serieChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Top 15 Distribuidores — ${topProduto} (${LABEL.MIL_M3})`}
                        loading={topLoading}
                        height={420}
                        containerStyle={{ minHeight: 460 }}
                      >
                        <PlotlyChart
                          data={topChart.data}
                          layout={topChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 420 }}
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
