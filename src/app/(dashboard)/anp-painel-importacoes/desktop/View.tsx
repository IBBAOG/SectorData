"use client";

// Desktop view for /anp-painel-importacoes.
// Migrated verbatim from the old page.tsx: same sidebar + dual-chart layout,
// same shared components (DashboardHeader, MultiSelectFilter, PeriodSlider,
// ChartSection, ExportPanel). Data plumbing is delegated to useAnpPainelImpData.
//
// Binding sync rule: any meaningful change here (new filter, chart, KPI, copy)
// must land in mobile/View.tsx in the SAME commit, or the commit message must
// declare [desktop-only] with explicit reason. See CLAUDE.md § Dual-view policy.

import { useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

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
import { m3ToMilM3, LABEL } from "../../../../lib/units";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import type {
  AnpPainelImpSerieRow,
  AnpPainelImpTopDistRow,
} from "../../../../lib/rpc";

import {
  useAnpPainelImpData,
  PALETTE,
  TOP_DIST_COLOR,
} from "../useAnpPainelImpData";

// ─── Chart builders (desktop) ─────────────────────────────────────────────────

// volume_m3 → mil m³: m3 / 1e3.
// Source pipeline: scraper reads "Quantidade (mil m³)" * 1000 → stores as m³.
function buildSerieChart(
  rows: AnpPainelImpSerieRow[],
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  // Server already filtered by period; this client filter respects the
  // product checkboxes without refetch.
  const filtered = rows.filter((r) => produtos.includes(r.nome_produto));
  if (!filtered.length) return emptyPlot(300);

  const byProduto: Record<string, AnpPainelImpSerieRow[]> = {};
  for (const r of filtered) (byProduto[r.nome_produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter((p) => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort((a, b) =>
        a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
      );
      return {
        type: "scatter",
        mode: "lines",
        name: p,
        x: data.map((r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
        y: data.map((r) => m3ToMilM3(r.volume_m3 ?? 0)),
        line: { width: 2, color: PALETTE[i % PALETTE.length] },
        hovertemplate: `${p}: %{y:.1f} ${LABEL.MIL_M3}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 300,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${LABEL.MIL_M3} / month` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: {
        orientation: "h",
        yanchor: "bottom",
        y: 1.01,
        xanchor: "left",
        x: 0,
        font: { size: 10 },
      },
    },
  };
}

function buildTopDistChart(
  rows: AnpPainelImpTopDistRow[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(420);
  const sorted = [...rows].sort(
    (a, b) => (b.total_m3 ?? 0) - (a.total_m3 ?? 0),
  );
  return {
    data: [
      {
        type: "bar",
        orientation: "h",
        x: sorted.map((r) => m3ToMilM3(r.total_m3 ?? 0)),
        y: sorted.map((r) => r.distribuidor),
        marker: { color: TOP_DIST_COLOR },
        hovertemplate: `%{y}: %{x:.1f} ${LABEL.MIL_M3}<extra></extra>`,
      } as PlotData,
    ],
    layout: {
      ...COMMON_LAYOUT,
      height: 420,
      margin: { t: 10, b: 40, l: 200, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: LABEL.MIL_M3 } },
      yaxis: {
        autorange: "reversed" as const,
        showgrid: false,
        zeroline: false,
        tickfont: { size: 10 },
      },
    },
  };
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard(
    "anp-painel-importacoes",
  );

  const {
    filtros,
    serieRows,
    topRows,
    allYears,
    yMin,
    yMax,
    hasYears,
    hasData,
    loading,
    serieLoading,
    topLoading,
    filters,
    setFilters,
    toggleProduto,
    resetProdutos,
    exportRows,
  } = useAnpPainelImpData();

  const [excelLoading, setExcelLoading] = useState(false);

  const serieChart = useMemo(
    () => buildSerieChart(serieRows, filters.selectedProdutos),
    [serieRows, filters.selectedProdutos],
  );

  const topChart = useMemo(() => buildTopDistChart(topRows), [topRows]);

  if (visLoading || !visible) return <></>;

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
                label="Product (Series)"
                items={filtros.produtos}
                selected={filters.selectedProdutos}
                onToggle={toggleProduto}
                onClear={
                  filtros.produtos.length > 0 &&
                  filters.selectedProdutos.length < filtros.produtos.length
                    ? resetProdutos
                    : undefined
                }
                swatch={(p) => {
                  const i = filtros.produtos.indexOf(p);
                  return PALETTE[i % PALETTE.length];
                }}
                idPrefix="pimp"
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasYears && (
                  <PeriodSlider
                    years={allYears}
                    value={filters.yearRangeIdx}
                    onChange={(v) => setFilters({ yearRangeIdx: v })}
                  />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Top Distributors — Product
                </div>
                <select
                  className="form-select form-select-sm"
                  value={filters.topProduto}
                  onChange={(e) => setFilters({ topProduto: e.target.value })}
                  style={{ fontFamily: "Arial", fontSize: 11 }}
                >
                  {filtros.produtos.map((p) => (
                    <option key={p} value={p}>
                      {p}
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
                title="ANP Panel — Distributor Imports"
                sub={`Monthly volumes imported by distributor, state and product (volume in ${LABEL.MIL_M3})`}
                period={
                  hasYears && yMin != null && yMax != null ? [yMin, yMax] : null
                }
                rightSlot={
                  hasData ? (
                    <ExportPanel
                      actions={[
                        {
                          kind: "excel",
                          label: "formatted data .xl",
                          busy: excelLoading,
                          loadingLabel: "Generating Excel...",
                          disabled:
                            loading || exportRows.length === 0 || excelLoading,
                          onClick: async () => {
                            setExcelLoading(true);
                            try {
                              await downloadGenericExcel<AnpPainelImpSerieRow>({
                                rows: exportRows,
                                filename: "ANP-Imports-Panel",
                                title:
                                  "ANP Panel — Distributor Imports (National Total)",
                                sheetName: "Imports",
                                columns: [
                                  { key: "ano",          header: "Year" },
                                  { key: "mes",          header: "Month" },
                                  { key: "nome_produto", header: "Product",     width: 26 },
                                  { key: "volume_m3",    header: "Volume (m³)", format: "#,##0" },
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
                              rows: exportRows as unknown as Record<string, unknown>[],
                              filename: "ANP-Imports-Panel",
                            });
                          },
                        },
                      ]}
                    />
                  ) : null
                }
              />

              {loading ? (
                <BarrelLoading />
              ) : !hasData ? (
                <div
                  className="d-flex justify-content-center align-items-center my-5"
                  style={{
                    minHeight: 240,
                    color: "#888",
                    fontFamily: "Arial",
                    fontSize: 14,
                  }}
                >
                  No data available for this module at this time.
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Monthly Imported Volume by Product — National Total (${LABEL.MIL_M3} / month)`}
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
                        title={`Top 15 Distributors — ${filters.topProduto} (${LABEL.MIL_M3})`}
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
