"use client";

// Desktop view for /anp-desembaracos.
// Migrated verbatim from the old page.tsx: same sidebar + dual-chart layout,
// same shared components (DashboardHeader, MultiSelectFilter, PeriodSlider,
// ChartSection, ExportPanel). Data plumbing is delegated to
// useAnpDesembaracosData.
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
import { kgToMilTon, LABEL } from "../../../../lib/units";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import type {
  AnpDesembaracosRow,
  AnpDesembaracosTopPaisRow,
} from "../../../../lib/rpc";

import {
  useAnpDesembaracosData,
  PALETTE,
  TOP_COUNTRIES_COLOR,
} from "../useAnpDesembaracosData";

// ─── Helpers ────────────────────────────────────────────────────────────────
//
// quantidade_kg → kt (thousand tons): kg / 1e6 = thousand metric tons.
// Math: 1 kt = 1,000 t = 1,000,000 kg. Divisor 1e6 matches label "kt".

function buildSerieChart(
  rows: AnpDesembaracosRow[],
  ncms: string[],
  ncmCodigos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  // Server already filtered by period; aggregate by (ano, mes, ncm_codigo)
  // summing across paises.
  const filtered = rows.filter((r) => ncms.includes(r.ncm_codigo));
  if (!filtered.length) return emptyPlot(300);

  const byKey: Record<string, number> = {};
  const ncmNames: Record<string, string> = {};
  for (const r of filtered) {
    const key = `${r.ncm_codigo}|${r.ano}-${String(r.mes).padStart(2, "0")}`;
    byKey[key] = (byKey[key] ?? 0) + (r.quantidade_kg ?? 0);
    ncmNames[r.ncm_codigo] = r.ncm_nome ?? r.ncm_codigo;
  }

  const allDates = Array.from(
    new Set(filtered.map((r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`)),
  ).sort();

  // Use stable palette index from the canonical filtros order so colours stay
  // pinned to NCMs even when the selection set changes.
  const traces: PlotData[] = ncms
    .filter((ncm) => filtered.some((r) => r.ncm_codigo === ncm))
    .map((ncm) => {
      const idx = Math.max(0, ncmCodigos.indexOf(ncm));
      return {
        type: "scatter",
        mode: "lines",
        name: ncmNames[ncm] ?? ncm,
        x: allDates,
        y: allDates.map((d) => kgToMilTon(byKey[`${ncm}|${d}`] ?? 0)),
        line: { width: 2, color: PALETTE[idx % PALETTE.length] },
        hovertemplate: `${ncmNames[ncm] ?? ncm}: %{y:.1f} ${LABEL.MIL_T}<extra></extra>`,
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
        font: { size: 10 },
      },
    },
  };
}

function buildTopChart(
  rows: AnpDesembaracosTopPaisRow[],
  ncmNome: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(380);
  const sorted = [...rows].sort(
    (a, b) => (b.total_kg ?? 0) - (a.total_kg ?? 0),
  );
  return {
    data: [
      {
        type: "bar",
        orientation: "h",
        x: sorted.map((r) => kgToMilTon(r.total_kg ?? 0)),
        y: sorted.map((r) => r.pais_origem),
        marker: { color: TOP_COUNTRIES_COLOR },
        hovertemplate: `%{y}: %{x:.1f} ${LABEL.MIL_T}<extra></extra>`,
      } as PlotData,
    ],
    layout: {
      ...COMMON_LAYOUT,
      height: 420,
      margin: { t: 36, b: 40, l: 150, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: LABEL.MIL_T } },
      yaxis: {
        autorange: "reversed" as const,
        showgrid: false,
        zeroline: false,
        tickfont: { size: 10 },
      },
      title: {
        text: `Top Origin Countries — ${ncmNome}`,
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
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-desembaracos");

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
    toggleNcm,
    resetNcms,
    setTopNcm,
    ncmCodigos,
    ncmNomeMap,
    topNcmNome,
    colorForNcm,
  } = useAnpDesembaracosData();

  const [excelLoading, setExcelLoading] = useState(false);

  const serieChart = useMemo(
    () => buildSerieChart(serieRows, filters.selectedNcms, ncmCodigos),
    [serieRows, filters.selectedNcms, ncmCodigos],
  );

  const topChart = useMemo(
    () => buildTopChart(topRows, topNcmNome),
    [topRows, topNcmNome],
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

              {/* NCM uses 11px font / 8x8 swatch in original — small variation
                  acceptable; default 12px+9x9 from MultiSelectFilter is close enough. */}
              <MultiSelectFilter
                label="NCM (Series)"
                items={ncmCodigos}
                selected={filters.selectedNcms}
                onToggle={toggleNcm}
                onClear={
                  ncmCodigos.length > 0 && filters.selectedNcms.length < ncmCodigos.length
                    ? resetNcms
                    : undefined
                }
                swatch={(code) => colorForNcm(code)}
                itemLabel={(code) => ncmNomeMap[code] ?? code}
                idPrefix="ncm"
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
                <div className="sidebar-filter-label">Top Countries — NCM</div>
                <select
                  className="form-select form-select-sm"
                  value={filters.topNcm}
                  onChange={(e) => setTopNcm(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 11 }}
                >
                  {filtros.ncms.map((n) => (
                    <option key={n.ncm_codigo} value={n.ncm_codigo}>
                      {n.ncm_nome ?? n.ncm_codigo}
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
                title="ANP — Import Customs Clearances (Petroleum, Gas and Derivatives)"
                sub={`Monthly volumes cleared in imports by NCM and country of origin (mass in ${LABEL.MIL_T})`}
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
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
                            loading || serieRows.length === 0 || excelLoading,
                          onClick: async () => {
                            setExcelLoading(true);
                            try {
                              await downloadGenericExcel<AnpDesembaracosRow>({
                                rows: serieRows,
                                filename: "ANP-Customs-Clearances",
                                title: "ANP — Import Customs Clearances",
                                sheetName: "Clearances",
                                columns: [
                                  { key: "ano",           header: "Year" },
                                  { key: "mes",           header: "Month" },
                                  { key: "ncm_codigo",    header: "NCM" },
                                  { key: "ncm_nome",      header: "NCM Description", width: 36 },
                                  { key: "pais_origem",   header: "Origin Country",  width: 22 },
                                  { key: "quantidade_kg", header: "Quantity (kg)",   format: "#,##0" },
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
                              filename: "ANP-Customs-Clearances",
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
                        title={`Imported Volumes by NCM — National Total (${LABEL.MIL_T} / month)`}
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
                        title={`Top Origin Countries — ${topNcmNome} (${LABEL.MIL_T})`}
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
