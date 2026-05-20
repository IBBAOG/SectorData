"use client";

// Desktop view for /sindicom — verbatim move from the old page.tsx, re-wired
// to consume useSindicomData instead of inline state/effects.
//
// Charts:
//  1. Monthly Volume by Product (m³) — multi-line, one trace per product.
//  2. Market Share by Company — {product} (Top 15) — horizontal bar, %.
//
// Binding sync rule: any meaningful change here (new filter, chart, KPI,
// export, copy) must land in mobile/View.tsx in the SAME commit, or the
// commit must declare [desktop-only] with an explicit reason. See
// CLAUDE.md § "Dual-view policy".

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
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import type { SindicomSerieRow } from "../../../../lib/rpc";

import {
  useSindicomData,
  PRODUTO_COLORS,
  PALETTE,
  type MarketShareEntry,
} from "../useSindicomData";

// ── Helpers ────────────────────────────────────────────────────────────────────

function rowDateKey(r: SindicomSerieRow) {
  return `${r.ano}-${String(r.mes).padStart(2, "0")}`;
}

function buildVolumeChart(
  filteredRows: SindicomSerieRow[],
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!filteredRows.length) return emptyPlot(320);

  // Aggregate by (produto, date_key) summing volume across empresas+segmentos.
  const agg: Record<string, Record<string, number>> = {};
  for (const r of filteredRows) {
    if (!agg[r.nome_produto]) agg[r.nome_produto] = {};
    const k = rowDateKey(r);
    agg[r.nome_produto][k] = (agg[r.nome_produto][k] ?? 0) + (r.volume ?? 0);
  }

  const traces: PlotData[] = produtos
    .filter((p) => agg[p])
    .map((p, i) => {
      const entries = Object.entries(agg[p]).sort(([a], [b]) => a.localeCompare(b));
      const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
      return {
        type: "scatter", mode: "lines",
        name: p,
        x: entries.map(([d]) => d + "-01"),
        y: entries.map(([, v]) => v),
        line: { width: 2, color },
        hovertemplate: `${p}: %{y:,.0f} m³<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      margin: { t: 10, b: 50, l: 90, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "Volume (m³)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildMarketShareChart(
  marketShare: MarketShareEntry[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!marketShare.length) return emptyPlot(400);

  const topShare = marketShare[0]?.sharePct ?? 0;

  return {
    data: [{
      type: "bar",
      orientation: "h",
      x: marketShare.map((e) => e.sharePct),
      y: marketShare.map((e) => e.empresa),
      marker: { color: "#2196F3" },
      hovertemplate: "%{y}: %{x:.1f}%<extra></extra>",
      text: marketShare.map((e) => `${e.sharePct.toFixed(1)}%`),
      textposition: "outside",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT,
      height: 400,
      margin: { t: 10, b: 50, l: 180, r: 60 },
      xaxis: { ...AXIS_LINE, title: { text: "Share (%)" }, range: [0, Math.min(100, topShare * 1.1 + 5)] },
      yaxis: { ...AXIS_LINE, autorange: "reversed" as const },
    },
  };
}

// ── View ──────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement | null {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("sindicom");

  const {
    filtros,
    allYears,
    yMin,
    yMax,
    hasYears,
    hasData,
    loading,
    serieLoading,
    filters,
    setFilters,
    toggleProduto,
    toggleSegmento,
    resetProdutos,
    resetSegmentos,
    filteredSerieRows,
    marketShare,
    exportRows,
  } = useSindicomData();

  const [excelLoading, setExcelLoading] = useState(false);

  const volChart = useMemo(
    () => buildVolumeChart(filteredSerieRows, filters.selectedProdutos),
    [filteredSerieRows, filters.selectedProdutos],
  );
  const msChart = useMemo(
    () => buildMarketShareChart(marketShare),
    [marketShare],
  );

  if (visLoading || !visible) return null;

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
                label="Product"
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
                  return PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
                }}
                idPrefix="sind-p"
              />

              <MultiSelectFilter
                label="Segment"
                items={filtros.segmentos}
                selected={filters.selectedSegmentos}
                onToggle={toggleSegmento}
                onClear={
                  filtros.segmentos.length > 0 &&
                  filters.selectedSegmentos.length < filtros.segmentos.length
                    ? resetSegmentos
                    : undefined
                }
                idPrefix="sind-s"
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
                <div className="sidebar-filter-label">Market Share — Product</div>
                <select
                  className="form-select form-select-sm"
                  value={filters.msProduto}
                  onChange={(e) => setFilters({ msProduto: e.target.value })}
                  disabled={filtros.produtos.length === 0}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {filtros.produtos.length === 0 && <option value="">—</option>}
                  {filtros.produtos.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="SINDICOM — Fuel Distribution by Company"
                sub="Monthly sales volumes of SINDICOM-associated distributors, by company, product and segment (market / consumer)"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={hasData ? (
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formatted data .xl",
                        busy: excelLoading,
                        loadingLabel: "Generating Excel...",
                        disabled: loading || exportRows.length === 0 || excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel<SindicomSerieRow>({
                              rows: exportRows,
                              filename: "SINDICOM",
                              title: "SINDICOM — Fuel Distribution by Company",
                              sheetName: "SINDICOM",
                              columns: [
                                { key: "ano",          header: "Year" },
                                { key: "mes",          header: "Month" },
                                { key: "empresa",      header: "Company", width: 24 },
                                { key: "nome_produto", header: "Product", width: 22 },
                                { key: "segmento",     header: "Segment", width: 18 },
                                { key: "volume",       header: "Volume (m³)", format: "#,##0" },
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
                            filename: "SINDICOM",
                          });
                        },
                      },
                    ]}
                  />
                ) : null}
              />

              {loading ? (
                <BarrelLoading />
              ) : !hasData ? (
                <div className="chart-container" style={{ padding: "32px 24px", textAlign: "center" }}>
                  <div style={{ fontFamily: "Arial", fontSize: 14, color: "#555", marginBottom: 8 }}>
                    Waiting for data — pipeline has not run yet.
                  </div>
                  <div style={{ fontFamily: "Arial", fontSize: 12, color: "#888" }}>
                    The SINDICOM scraper is blocked by Cloudflare when run locally. Trigger the workflow{" "}
                    <code style={{ fontSize: 11 }}>etl_sindicom.yml</code> via GitHub Actions{" "}
                    (<em>Actions → SINDICOM — Sync → Run workflow</em>) to populate the table.
                    See <code style={{ fontSize: 11 }}>docs/app/sindicom.md</code> for details.
                  </div>
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title="Monthly Volume by Product (m³)"
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={volChart.data}
                          layout={volChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Market Share by Company — ${filters.msProduto} (Top 15)`}
                        loading={serieLoading}
                        height={400}
                      >
                        <PlotlyChart
                          data={msChart.data}
                          layout={msChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 400 }}
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
