"use client";

/**
 * Desktop view — /anp-precos-produtores (≥769px).
 *
 * Verbatim port of the original page.tsx body, wired to the shared hook.
 * All data, filter state, and chart derivations come from useAnpPrecosProdutoresData.
 *
 * Binding sync rule: any meaningful change here (new filter, chart, KPI, copy)
 * must land in ../mobile/View.tsx in the SAME commit, or the commit message
 * must declare `[desktop-only]` with an explicit reason.
 */

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
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import {
  useAnpPrecosProdutoresData,
  ALL_REGIOES,
  REGIAO_COLOR,
} from "../useAnpPrecosProdutoresData";
import { useState } from "react";

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard(
    "anp-precos-produtores",
  );

  const {
    filtros,
    serieRows,
    loading,
    serieLoading,
    selectedProduto,
    selectedRegioes,
    allYears,
    yearRange,
    setProduto,
    toggleRegiao,
    setRegioes,
    setYearRange,
    chart,
  } = useAnpPrecosProdutoresData();

  const [excelLoading, setExcelLoading] = useState(false);

  if (visLoading || !visible) return <></>;

  const hasYears = allYears.length > 0;
  const yMin = hasYears ? allYears[yearRange[0]] : null;
  const yMax = hasYears ? allYears[yearRange[1]] : null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Product</div>
                <select
                  className="form-select form-select-sm"
                  value={selectedProduto}
                  onChange={(e) => setProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {filtros.produtos.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <MultiSelectFilter
                label="Region"
                items={ALL_REGIOES}
                selected={selectedRegioes}
                onToggle={toggleRegiao}
                onClear={
                  selectedRegioes.length < ALL_REGIOES.length
                    ? () => setRegioes(ALL_REGIOES)
                    : undefined
                }
                swatch={(r) => REGIAO_COLOR[r]}
                idPrefix="reg"
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasYears && (
                  <PeriodSlider
                    years={allYears}
                    value={yearRange}
                    onChange={setYearRange}
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Main content ─────────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP — Weighted Average Prices: Producers and Importers"
                sub="Weekly weighted-average prices charged by producers and importers, by region"
                period={
                  hasYears && yMin != null && yMax != null
                    ? [yMin, yMax]
                    : null
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
                          loading || serieRows.length === 0 || excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel({
                              rows: serieRows,
                              filename: "ANP-Producer-Prices",
                              title: `ANP — Producer and Importer Prices — ${selectedProduto}`,
                              sheetName: "Prices",
                              columns: [
                                { key: "data_inicio", header: "Start" },
                                { key: "data_fim",    header: "End" },
                                { key: "produto",     header: "Product", width: 28 },
                                { key: "regiao",      header: "Region",  width: 16 },
                                { key: "preco",       header: "Price",   format: "0.0000" },
                                { key: "unidade",     header: "Unit" },
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
                            filename: "ANP-Producer-Prices",
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
                <div className="row mb-2">
                  <div className="col-12">
                    <ChartSection
                      title={`Price by Region — ${selectedProduto}`}
                      loading={serieLoading}
                      height={360}
                    >
                      <PlotlyChart
                        data={chart.data}
                        layout={chart.layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%", height: 360 }}
                      />
                    </ChartSection>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
