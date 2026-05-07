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
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import { kgToMilTon, LABEL } from "../../../lib/units";
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpGlpSerie,
  rpcGetAnpGlpFiltros,
  type AnpGlpSerieRow,
  type AnpGlpFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIA_INFO: Record<string, { label: string; color: string }> = {
  "P13":                { label: "P13 (Botijão 13 kg)", color: "#2196F3" },
  "Outros - GLP":       { label: "Outros - GLP",        color: "#4CAF50" },
  "Outros - Especiais": { label: "Outros - Especiais",  color: "#9C27B0" },
};
const MAIN_CATEGORIAS = Object.keys(CATEGORIA_INFO);

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildTrendChart(
  rows: AnpGlpSerieRow[],
  categorias: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => categorias.includes(r.categoria));
  if (!filtered.length) return emptyPlot(300);

  // Aggregate by (ano, mes, categoria)
  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    if (!agg[r.categoria]) agg[r.categoria] = {};
    agg[r.categoria][key] = (agg[r.categoria][key] ?? 0) + (r.vendas_kg ?? 0);
  }

  const allKeys = Array.from(
    new Set(filtered.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`))
  ).sort();

  const traces: PlotData[] = categorias
    .filter(c => agg[c])
    .map(c => {
      const info = CATEGORIA_INFO[c];
      return {
        type: "scatter", mode: "lines",
        name: info?.label ?? c,
        x: allKeys,
        y: allKeys.map(k => kgToMilTon(agg[c][k] ?? 0)),
        line: { width: 2, color: info?.color ?? "#999" },
        hovertemplate: `${info?.label ?? c}: %{y:.1f} ${LABEL.MIL_T}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 300,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${LABEL.MIL_T} / mês` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildTopDistChart(
  rows: AnpGlpSerieRow[],
  categoria: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r.categoria === categoria);
  if (!filtered.length) return emptyPlot(360);

  const byDist: Record<string, number> = {};
  for (const r of filtered) {
    byDist[r.distribuidora] = (byDist[r.distribuidora] ?? 0) + (r.vendas_kg ?? 0);
  }

  const sorted = Object.entries(byDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const color = CATEGORIA_INFO[categoria]?.color ?? "#2196F3";

  return {
    data: [{
      type: "bar", orientation: "h",
      x: sorted.map(([, v]) => kgToMilTon(v)),
      y: sorted.map(([k]) => k),
      marker: { color },
      hovertemplate: `%{y}: %{x:.1f} ${LABEL.MIL_T}<extra></extra>`,
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT,
      height: 420,
      margin: { t: 36, b: 40, l: 160, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: LABEL.MIL_T } },
      yaxis: { autorange: "reversed" as const, showgrid: false, zeroline: false, tickfont: { size: 10 } },
      title: {
        text: `Top 15 Distribuidoras — ${CATEGORIA_INFO[categoria]?.label ?? categoria}`,
        font: { size: 13, family: "Arial" },
        x: 0, xanchor: "left",
        pad: { l: 0 },
      },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpGlpPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-glp");
  const supabase = getSupabaseClient();

  const [loading, setLoading]                 = useState(true);
  const [, setFiltros]                        = useState<AnpGlpFiltros>({ distribuidoras: [], categorias: [], ano_min: null, ano_max: null });
  const [serieRows, setSerieRows]             = useState<AnpGlpSerieRow[]>([]);
  const [allYears, setAllYears]               = useState<number[]>([]);
  const [yearRange, setYearRange]             = useState<[number, number]>([0, 0]);
  const [selectedCats, setSelectedCats]       = useState<string[]>(MAIN_CATEGORIAS);
  const [topDistCat, setTopDistCat]           = useState<string>("P13");
  const [excelLoading, setExcelLoading]       = useState(false);

  // ── Initial load: filtros + first serie fetch (last 10 years) ────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpGlpFiltros(supabase);
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

      const rows = await rpcGetAnpGlpSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMax,
      });
      if (!cancelled) {
        setSerieRows(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      return rpcGetAnpGlpSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
    },
    [supabase, loading, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  const trendChart = useMemo(
    () => buildTrendChart(serieRows, selectedCats),
    [serieRows, selectedCats],
  );

  const topDistChart = useMemo(
    () => buildTopDistChart(serieRows, topDistCat),
    [serieRows, topDistCat],
  );

  if (visLoading || !visible) return null;

  const toggleCat = (c: string) =>
    setSelectedCats(prev =>
      prev.includes(c)
        ? prev.length > 1 ? prev.filter(x => x !== c) : prev
        : [...prev, c]
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
                label="Categoria"
                items={MAIN_CATEGORIAS}
                selected={selectedCats}
                onToggle={toggleCat}
                onClear={selectedCats.length < MAIN_CATEGORIAS.length ? () => setSelectedCats(MAIN_CATEGORIAS) : undefined}
                swatch={(c) => CATEGORIA_INFO[c].color}
                itemLabel={(c) => CATEGORIA_INFO[c].label}
                idPrefix="cat"
                counterTotal={MAIN_CATEGORIAS.length}
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasYears && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Top Distribuidoras — Categoria</div>
                <select
                  className="form-select form-select-sm"
                  value={topDistCat}
                  onChange={e => setTopDistCat(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {MAIN_CATEGORIAS.map(c => (
                    <option key={c} value={c}>{CATEGORIA_INFO[c].label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP — Vendas de GLP por Recipiente"
                sub="Vendas mensais de GLP por distribuidora e categoria de recipiente (P13, Outros - GLP, Outros - Especiais)"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formatted data .xl",
                        busy: excelLoading,
                        loadingLabel: "Gerando Excel...",
                        disabled: loading || serieRows.length === 0 || excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel<AnpGlpSerieRow>({
                              rows: serieRows,
                              filename: "ANP-GLP",
                              title: "ANP — Vendas de GLP por Distribuidora",
                              sheetName: "Vendas GLP",
                              columns: [
                                { key: "ano",           header: "Ano" },
                                { key: "mes",           header: "Mês" },
                                { key: "distribuidora", header: "Distribuidora", width: 28 },
                                { key: "categoria",     header: "Categoria",     width: 22 },
                                { key: "vendas_kg",     header: "Vendas (kg)",   format: "#,##0" },
                              ],
                            });
                          } catch (e) {
                            console.error("Excel export failed", e);
                          } finally {
                            setExcelLoading(false);
                          }
                        },
                      },
                      {
                        kind: "csv",
                        label: "all data .csv",
                        disabled: loading || serieRows.length === 0,
                        onClick: () => {
                          downloadCsv({
                            rows: serieRows as unknown as Record<string, unknown>[],
                            filename: "ANP-GLP",
                          });
                        },
                      },
                    ]}
                  />
                }
              />

              {loading ? (
                <BarrelLoading />
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Vendas Mensais — Total Nacional (${LABEL.MIL_T})`}
                        loading={serieLoading}
                        height={300}
                      >
                        <PlotlyChart
                          data={trendChart.data}
                          layout={trendChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ minHeight: 460, position: "relative", opacity: serieLoading ? 0.5 : 1 }}>
                        <PlotlyChart
                          data={topDistChart.data}
                          layout={topDistChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 420 }}
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
