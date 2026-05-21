"use client";

// Desktop view for /anp-lpc.
// Migrated verbatim from the old page.tsx: same sidebar + dual-chart layout,
// same shared components (DashboardHeader, MultiSelectFilter, PeriodSlider,
// ChartSection, ExportPanel + ExportModal Tier 2). Data plumbing is delegated
// to useAnpLpcData.
//
// Binding sync rule: any meaningful change here (new filter, chart, KPI, copy)
// must land in mobile/View.tsx in the SAME commit, or the commit message must
// declare [desktop-only] with explicit reason. See CLAUDE.md § Dual-view policy.

import { useMemo } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import ExportModal from "../../../../components/dashboard/ExportModal";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../../lib/plotlyDefaults";
import type {
  AnpLpcNacionalRow,
  AnpLpcSerieRow,
} from "../../../../lib/rpc";

import {
  useAnpLpcData,
  PRODUTO_COLORS,
  PALETTE,
  UF_REGIAO,
  REGIAO_COLORS,
} from "../useAnpLpcData";

// ─── Chart builders (desktop multi-line) ──────────────────────────────────────

function buildNacionalChart(
  rows: AnpLpcNacionalRow[],
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter((r) => produtos.includes(r.produto));
  if (!filtered.length) return emptyPlot(320);

  const byProduto: Record<string, AnpLpcNacionalRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter((p) => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
      const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
      return {
        type: "scatter",
        mode: "lines",
        name: p,
        x: data.map((r) => r.data_fim),
        y: data.map((r) => r.preco_medio_venda),
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
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L (or kg)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildRegiaoChart(
  rows: AnpLpcSerieRow[],
  produto: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter((r) => r.produto === produto);
  if (!filtered.length) return emptyPlot(280);

  // Aggregate by regiao (mean across UFs per week)
  const regiaoTotals: Record<string, Record<string, { sum: number; cnt: number }>> = {};
  for (const r of filtered) {
    const reg = UF_REGIAO[r.estado] ?? r.estado;
    if (!regiaoTotals[reg]) regiaoTotals[reg] = {};
    if (!regiaoTotals[reg][r.data_fim]) regiaoTotals[reg][r.data_fim] = { sum: 0, cnt: 0 };
    regiaoTotals[reg][r.data_fim].sum += r.preco_medio_venda ?? 0;
    regiaoTotals[reg][r.data_fim].cnt += 1;
  }

  const regioes = Object.keys(regiaoTotals).sort();
  const traces: PlotData[] = regioes.map((reg) => {
    const entries = Object.entries(regiaoTotals[reg])
      .sort(([a], [b]) => a.localeCompare(b));
    return {
      type: "scatter",
      mode: "lines",
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

// ─── View ─────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-lpc");

  const lpc = useAnpLpcData();

  const nacChart = useMemo(
    () => buildNacionalChart(lpc.nacionalRows, lpc.selectedProdutos),
    [lpc.nacionalRows, lpc.selectedProdutos],
  );

  const regChart = useMemo(
    () => buildRegiaoChart(lpc.estadoRows, lpc.detailProduto),
    [lpc.estadoRows, lpc.detailProduto],
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

              <MultiSelectFilter
                label="Product"
                items={lpc.filtros.produtos}
                selected={lpc.selectedProdutos}
                onToggle={lpc.toggleProduto}
                onClear={
                  lpc.selectedProdutos.length < lpc.filtros.produtos.length
                    ? () => lpc.setSelectedProdutos(lpc.filtros.produtos)
                    : undefined
                }
                swatch={(p) => {
                  const i = lpc.filtros.produtos.indexOf(p);
                  return PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
                }}
                idPrefix="lpc"
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!lpc.initialLoading && lpc.hasYears && (
                  <PeriodSlider
                    years={lpc.allYears}
                    value={lpc.yearRange}
                    onChange={lpc.setYearRange}
                  />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Detail by Region — Product</div>
                <select
                  className="form-select form-select-sm"
                  value={lpc.detailProduto}
                  onChange={(e) => lpc.setDetailProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {lpc.filtros.produtos.map((p) => (
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
                title="ANP LPC — Fuel Price Survey"
                sub="Weekly average price at gas stations by product and state (weighted by number of surveyed stations)"
                period={
                  lpc.hasYears && lpc.yMin != null && lpc.yMax != null
                    ? [lpc.yMin, lpc.yMax]
                    : null
                }
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "Excel",
                        disabled:
                          lpc.initialLoading || lpc.excelLoading || lpc.csvLoading,
                        onClick: lpc.openExportModal,
                      },
                      {
                        kind: "csv",
                        label: "CSV",
                        disabled:
                          lpc.initialLoading || lpc.excelLoading || lpc.csvLoading,
                        onClick: lpc.openExportModal,
                      },
                    ]}
                  />
                }
              />

              {lpc.initialLoading ? (
                <BarrelLoading />
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title="Average National Price — Sale (R$/L or R$/kg)"
                        loading={lpc.serieLoading}
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
                        title={`Price by Region — ${lpc.detailProduto}`}
                        loading={lpc.serieLoading}
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

      <ExportModal
        open={lpc.exportOpen}
        onClose={lpc.closeExportModal}
        title="Export — ANP LPC"
        datasetKey="anp_lpc"
        currentFilters={lpc.exportFilters}
        countFetcher={lpc.fetchExportCount}
        excelBusy={lpc.excelLoading}
        csvBusy={lpc.csvLoading}
        loadingLabel={lpc.excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={lpc.onExportExcel}
        onExportCsv={lpc.onExportCsv}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Period
              </div>
              {lpc.hasYears && (
                <PeriodSlider
                  years={lpc.allYears}
                  value={lpc.exportRange}
                  onChange={lpc.setExportRange}
                />
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Products
              </div>
              <MultiSelectFilter
                label="Products"
                items={lpc.filtros.produtos}
                selected={lpc.exportProdutos}
                onToggle={lpc.toggleExportProduto}
                onClear={
                  lpc.exportProdutos.length < lpc.filtros.produtos.length
                    ? () => lpc.setExportProdutos(lpc.filtros.produtos)
                    : undefined
                }
                swatch={(p) => {
                  const i = lpc.filtros.produtos.indexOf(p);
                  return PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
                }}
                idPrefix="lpc-export"
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                States{" "}
                <span style={{ color: "#888", fontWeight: 400 }}>
                  ({lpc.exportEstados.length === 0 ? lpc.filtros.estados.length : lpc.exportEstados.length}/{lpc.filtros.estados.length})
                </span>
              </div>
              <SearchableMultiSelect
                options={lpc.filtros.estados}
                value={lpc.exportEstados}
                onChange={lpc.setExportEstados}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
