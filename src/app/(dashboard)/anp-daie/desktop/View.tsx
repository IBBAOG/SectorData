"use client";

// Desktop view for /anp-daie.
// Migrated verbatim from the old page.tsx: same sidebar + dual-chart layout,
// same shared components (DashboardHeader, MultiSelectFilter, PeriodSlider,
// ChartSection, ExportPanel). Data plumbing is delegated to useAnpDaieData.
//
// Binding sync rule: any meaningful change here (new filter, chart, KPI, copy)
// must land in mobile/View.tsx in the SAME commit, or the commit message must
// declare [desktop-only] with explicit reason. See CLAUDE.md § Dual-view policy.

import { useMemo } from "react";
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
import type { AnpDaieRow } from "../../../../lib/rpc";

import {
  useAnpDaieData,
  PRODUTO_COLORS,
  PALETTE,
  capitalize,
} from "../useAnpDaieData";
import { useState } from "react";

// ─── Chart builder (desktop multi-line) ───────────────────────────────────────

function buildOperacaoChart(
  rows: AnpDaieRow[],
  operacao: string,
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!operacao) return emptyPlot(280);
  const filtered = rows.filter(
    (r) => r.operacao === operacao && produtos.includes(r.produto),
  );
  if (!filtered.length) return emptyPlot(280);

  const byProduto: Record<string, AnpDaieRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter((p) => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort((a, b) =>
        a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
      );
      const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
      return {
        type: "scatter",
        mode: "lines",
        name: p,
        x: data.map((r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
        y: data.map((r) => m3ToMilM3(r.volume_m3 ?? 0)),
        line: { width: 2, color },
        hovertemplate: `${p}: %{y:.2f} ${LABEL.MIL_M3}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
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

// ─── View ─────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-daie");

  const {
    filtros,
    serieRows,
    allYears,
    yMin,
    yMax,
    hasYears,
    hasData,
    importOp,
    exportOp,
    loading,
    serieLoading,
    filters,
    setFilters,
    toggleProduto,
    resetProdutos,
    exportRows,
  } = useAnpDaieData();

  const [excelLoading, setExcelLoading] = useState(false);

  // Charts (memoised per operation)
  const importChart = useMemo(
    () => buildOperacaoChart(serieRows, importOp, filters.selectedProdutos),
    [serieRows, importOp, filters.selectedProdutos],
  );

  const exportChart = useMemo(
    () => buildOperacaoChart(serieRows, exportOp, filters.selectedProdutos),
    [serieRows, exportOp, filters.selectedProdutos],
  );

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

              {/* DAIE has its own swatch size (8x8 instead of 9x9) and capitalize labels.
                  We pass swatch+itemLabel to MultiSelectFilter; small swatch deviation
                  acceptable since the tighter sidebar uses 11px font. */}
              <MultiSelectFilter
                label="Product"
                items={filtros.produtos}
                selected={filters.selectedProdutos}
                onToggle={toggleProduto}
                onClear={
                  filters.selectedProdutos.length < filtros.produtos.length
                    ? resetProdutos
                    : undefined
                }
                swatch={(p) => {
                  const i = filtros.produtos.indexOf(p);
                  return PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
                }}
                itemLabel={(p) => capitalize(p)}
                idPrefix="daie"
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
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP — Open Data Imports and Exports"
                sub={`Monthly import and export volumes of petroleum derivatives (volume in ${LABEL.MIL_M3})`}
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
                              await downloadGenericExcel<AnpDaieRow>({
                                rows: exportRows,
                                filename: "ANP-DAIE",
                                title: "ANP — Open Data Imports and Exports",
                                sheetName: "DAIE",
                                columns: [
                                  { key: "ano",       header: "Year" },
                                  { key: "mes",       header: "Month" },
                                  { key: "produto",   header: "Product",     width: 32 },
                                  { key: "operacao",  header: "Operation",   width: 16 },
                                  { key: "volume_m3", header: "Volume (m³)", format: "#,##0" },
                                  { key: "valor_usd", header: "Value (USD)", format: "#,##0.00" },
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
                              filename: "ANP-DAIE",
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
                        title={`${capitalize(importOp || "Import")} (${LABEL.MIL_M3} / month)`}
                        loading={serieLoading}
                        height={280}
                      >
                        <PlotlyChart
                          data={importChart.data}
                          layout={importChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`${capitalize(exportOp || "Export")} (${LABEL.MIL_M3} / month)`}
                        loading={serieLoading}
                        height={280}
                      >
                        <PlotlyChart
                          data={exportChart.data}
                          layout={exportChart.layout}
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
