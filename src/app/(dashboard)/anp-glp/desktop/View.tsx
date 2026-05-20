"use client";

// Desktop view for /anp-glp — verbatim move from old page.tsx, re-wired to
// consume useAnpGlpData instead of inline state/effects.
//
// Charts:
//  1. Monthly Sales — National Total (line, multi-category, kt/month)
//  2. Top 15 Distributors for selected category (horizontal bar, kt)
//
// Binding sync rule: any meaningful change here (new filter, chart, export)
// must land in mobile/View.tsx in the SAME commit, or the commit must declare
// [desktop-only] with an explicit reason. See CLAUDE.md § "Dual-view policy".

import type { Layout, PlotData } from "plotly.js";
import { useMemo, useState } from "react";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../../lib/plotlyDefaults";
import { kgToMilTon, LABEL } from "../../../../lib/units";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import type { AnpGlpSerieRow } from "../../../../lib/rpc";

import {
  useAnpGlpData,
  CATEGORIA_INFO,
  MAIN_CATEGORIAS,
} from "../useAnpGlpData";

// ─── Chart builders ───────────────────────────────────────────────────────────

function buildTrendChart(
  rows: AnpGlpSerieRow[],
  categorias: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter((r) => categorias.includes(r.categoria));
  if (!filtered.length) return emptyPlot(300);

  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    if (!agg[r.categoria]) agg[r.categoria] = {};
    agg[r.categoria][key] = (agg[r.categoria][key] ?? 0) + (r.vendas_kg ?? 0);
  }

  const allKeys = Array.from(
    new Set(filtered.map((r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`)),
  ).sort();

  const traces: PlotData[] = categorias
    .filter((c) => agg[c])
    .map((c) => {
      const info = CATEGORIA_INFO[c];
      return {
        type: "scatter",
        mode: "lines",
        name: info?.label ?? c,
        x: allKeys,
        y: allKeys.map((k) => kgToMilTon(agg[c][k] ?? 0)),
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
      yaxis: { ...AXIS_LINE, title: { text: `${LABEL.MIL_T} / month` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: {
        orientation: "h",
        yanchor: "bottom",
        y: 1.01,
        xanchor: "left",
        x: 0,
      },
    },
  };
}

function buildTopDistChart(
  rows: AnpGlpSerieRow[],
  categoria: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter((r) => r.categoria === categoria);
  if (!filtered.length) return emptyPlot(360);

  const byDist: Record<string, number> = {};
  for (const r of filtered) {
    byDist[r.distribuidora] =
      (byDist[r.distribuidora] ?? 0) + (r.vendas_kg ?? 0);
  }

  const sorted = Object.entries(byDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const color = CATEGORIA_INFO[categoria]?.color ?? "#2196F3";

  return {
    data: [
      {
        type: "bar",
        orientation: "h",
        x: sorted.map(([, v]) => kgToMilTon(v)),
        y: sorted.map(([k]) => k),
        marker: { color },
        hovertemplate: `%{y}: %{x:.1f} ${LABEL.MIL_T}<extra></extra>`,
      } as PlotData,
    ],
    layout: {
      ...COMMON_LAYOUT,
      height: 420,
      margin: { t: 36, b: 40, l: 160, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: LABEL.MIL_T } },
      yaxis: {
        autorange: "reversed" as const,
        showgrid: false,
        zeroline: false,
        tickfont: { size: 10 },
      },
      title: {
        text: `Top 15 Distributors — ${CATEGORIA_INFO[categoria]?.label ?? categoria}`,
        font: { size: 13, family: "Arial" },
        x: 0,
        xanchor: "left",
        pad: { l: 0 },
      },
    },
  };
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-glp");

  const {
    serieRows,
    allYears,
    yMin,
    yMax,
    loading,
    serieLoading,
    filters,
    setFilters,
    toggleCat,
    exportRows,
  } = useAnpGlpData();

  const [excelLoading, setExcelLoading] = useState(false);

  const trendChart = useMemo(
    () => buildTrendChart(serieRows, filters.selectedCats),
    [serieRows, filters.selectedCats],
  );

  const topDistChart = useMemo(
    () => buildTopDistChart(serieRows, filters.topDistCat),
    [serieRows, filters.topDistCat],
  );

  if (visLoading || !visible) return <></>;

  const hasYears = allYears.length > 0;

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

              <MultiSelectFilter
                label="Category"
                items={MAIN_CATEGORIAS}
                selected={filters.selectedCats}
                onToggle={toggleCat}
                onClear={
                  filters.selectedCats.length < MAIN_CATEGORIAS.length
                    ? () => setFilters({ selectedCats: [...MAIN_CATEGORIAS] })
                    : undefined
                }
                swatch={(c) => CATEGORIA_INFO[c]?.color ?? "#999"}
                itemLabel={(c) => CATEGORIA_INFO[c]?.label ?? c}
                idPrefix="cat"
                counterTotal={MAIN_CATEGORIAS.length}
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasYears && (
                  <PeriodSlider
                    years={allYears}
                    value={filters.yearRangeIdx}
                    onChange={(v) => setFilters({ yearRangeIdx: v as [number, number] })}
                  />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Top Distributors — Category
                </div>
                <select
                  className="form-select form-select-sm"
                  value={filters.topDistCat}
                  onChange={(e) => setFilters({ topDistCat: e.target.value })}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {MAIN_CATEGORIAS.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORIA_INFO[c]?.label ?? c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP — LPG Sales by Container"
                sub="Monthly LPG sales by distributor and container category (P13, Other - LPG, Other - Special)"
                period={
                  hasYears && yMin != null && yMax != null ? [yMin, yMax] : null
                }
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formatted data .xl",
                        busy: excelLoading,
                        loadingLabel: "Generating Excel...",
                        disabled:
                          loading ||
                          exportRows.length === 0 ||
                          excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel<AnpGlpSerieRow>({
                              rows: exportRows,
                              filename: "ANP-GLP",
                              title: "ANP — LPG Sales by Distributor",
                              sheetName: "LPG Sales",
                              columns: [
                                { key: "ano",           header: "Year" },
                                { key: "mes",           header: "Month" },
                                { key: "distribuidora", header: "Distributor", width: 28 },
                                { key: "categoria",     header: "Category",    width: 22 },
                                { key: "vendas_kg",     header: "Sales (kg)",  format: "#,##0" },
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
                        disabled: loading || exportRows.length === 0,
                        onClick: () => {
                          downloadCsv({
                            rows: exportRows as unknown as Record<
                              string,
                              unknown
                            >[],
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
                        title={`Monthly Sales — National Total (${LABEL.MIL_T})`}
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
                      <div
                        className="chart-container"
                        style={{
                          minHeight: 460,
                          position: "relative",
                          opacity: serieLoading ? 0.5 : 1,
                        }}
                      >
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
