"use client";

// Desktop view for /anp-glp — LPG Market Share.
//
// Faithful clone of /market-share/desktop/View.tsx retargeted at LPG:
//   - products = categories (Total (All LPG) first, then P13 / Other - LPG /
//     Other - Special), one line chart per product (distributors as lines).
//   - NO segment sub-charts (LPG segment is constant) — a single chart per
//     product instead of the Retail/B2B/TRR grid.
//   - NO region/UF sidebar filters.
//   - Big-3 = dynamic top-3 distributors by LPG volume.
//   - Unit toggle: % Share / thousand t.
//   - Export: unified <ExportButton> (Tier 1, full history) with a live size
//     estimate shown next to it. Desktop-only.

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import PlotlyChart from "../../../../components/PlotlyChart";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import CheckList from "../../../../components/CheckList";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import { ExportButton } from "../../../../lib/export/ui/ExportButton";
import { anpGlpExport } from "../../../../lib/export/dashboards/anpGlp";
import { formatBytes } from "../../../../lib/exportSizeHeuristics";
import {
  useAnpGlpData,
  categoryLabel,
  MODE_OPTIONS,
  type CompRow,
  type UnitMode,
} from "../useAnpGlpData";

const UNIT_OPTIONS: { value: UnitMode; label: string }[] = [
  { value: "share", label: "% Share" },
  { value: "volume", label: "thousand t" },
];

// ─── ComparisonTable ──────────────────────────────────────────────────────────

function ComparisonTable({ rows, unitMode = "share" }: { rows: CompRow[]; unitMode?: UnitMode }) {
  const fmt = (v: number | null) =>
    v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1);
  const headerLabel =
    unitMode === "share"
      ? "Market Share Var. (p.p.)"
      : "Volume Var. (thousand t)";
  const cellStyle = (v: number | null): React.CSSProperties => ({
    backgroundColor:
      v === null ? "transparent" : v > 0 ? "#C6E8D9" : v < 0 ? "#FFDDCC" : "transparent",
    color: v === null ? "#bbb" : "#1a1a1a",
    textAlign: "center",
    padding: "2px 10px",
    fontSize: 11,
    fontFamily: "Arial",
    whiteSpace: "nowrap",
    fontWeight: 400,
    border: "none",
  });
  const thStyle: React.CSSProperties = {
    fontFamily: "Arial",
    fontSize: 10,
    fontWeight: 700,
    color: "#ffffff",
    backgroundColor: "#000512",
    textAlign: "center",
    padding: "4px 10px",
    border: "none",
  };
  return (
    <table
      style={{
        borderCollapse: "collapse",
        width: "100%",
        margin: "6px 0 0 0",
        tableLayout: "fixed",
      }}
    >
      <colgroup>
        <col style={{ width: "30%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: "left", paddingLeft: 8 }}>
            {headerLabel}
          </th>
          <th style={thStyle}>MoM</th>
          <th style={thStyle}>QTD</th>
          <th style={thStyle}>YoY</th>
          <th style={thStyle}>YTD</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.player}
            style={i === rows.length - 1 ? { borderBottom: "2px solid #d0d0d0" } : {}}
          >
            <td
              style={{
                fontFamily: "Arial",
                fontSize: 11,
                color: "#1a1a1a",
                fontWeight: 400,
                padding: "2px 12px 2px 8px",
                whiteSpace: "nowrap",
                border: "none",
              }}
            >
              {row.player}
            </td>
            <td style={cellStyle(row.mom)}>{fmt(row.mom)}</td>
            <td style={cellStyle(row.q3m)}>{fmt(row.q3m)}</td>
            <td style={cellStyle(row.yoy)}>{fmt(row.yoy)}</td>
            <td style={cellStyle(row.ytd)}>{fmt(row.ytd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Desktop View ─────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-glp");

  const {
    seriesLoading,
    opcoes,
    datas,
    unitMode,
    setUnitMode,
    mode,
    setMode,
    sliderRange,
    setSliderRange,
    competidoresSelected,
    setCompetidoresSelected,
    playersOptions,
    applyFilters,
    clearFilters,
    showToast,
    productKeys,
    charts,
    compData,
    exportSizeEstimate,
  } = useAnpGlpData();

  if (!opcoes) return <></>;
  if (visLoading || !visible) return <></>;

  const estXlsx = exportSizeEstimate.estimate
    ? formatBytes(exportSizeEstimate.estimate.bytesXlsx)
    : null;

  return (
    <div>
      <NavBar />

      {showToast && (
        <div
          id="toast-filters"
          className="alert alert-success"
          role="alert"
          style={{
            fontFamily: "Arial",
            fontSize: 13,
            padding: "10px 14px",
            border: "none",
            boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          }}
        >
          Filters applied!
        </div>
      )}

      <div className="container-fluid g-0">
        <div className="row g-0">
          {/* Sidebar */}
          <div
            className="col-xxl-2 col-md-3 p-0"
            style={{ display: "flex", flexDirection: "column" }}
          >
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                <PeriodSlider
                  years={datas}
                  value={sliderRange}
                  onChange={setSliderRange}
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View Mode</div>
                <SegmentedToggle
                  options={MODE_OPTIONS.map((m) => ({ value: m, label: m }))}
                  value={mode}
                  onChange={setMode}
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Competitors</div>
                {mode === "Others" ? (
                  <SearchableMultiSelect
                    options={playersOptions}
                    value={competidoresSelected}
                    onChange={setCompetidoresSelected}
                  />
                ) : (
                  <CheckList
                    label="Competitors"
                    options={playersOptions}
                    value={competidoresSelected}
                    onChange={setCompetidoresSelected}
                    allLabel="All"
                    clearLabel="Clear"
                  />
                )}
              </div>

              <div className="row g-1 mt-1">
                <div className="col-6">
                  <button type="button" className="btn btn-apply" onClick={applyFilters}>
                    Apply
                  </button>
                </div>
                <div className="col-6">
                  <button type="button" className="btn btn-clear" onClick={clearFilters}>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="LPG Market Share"
                sub={
                  unitMode === "share"
                    ? "Distributor market share of Brazilian LPG (GLP) sales by container category (%)"
                    : "Distributor sales volume of Brazilian LPG (GLP) by container category (thousand t)"
                }
                lang="en"
                hideDivider
                rightSlot={
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {estXlsx && (
                      <span
                        style={{
                          fontFamily: "Arial",
                          fontSize: 11,
                          color: "#888",
                          whiteSpace: "nowrap",
                        }}
                        title="Estimated full-history export size"
                      >
                        ~{estXlsx}
                      </span>
                    )}
                    <ExportButton spec={anpGlpExport} />
                  </div>
                }
              />

              {/* Unit toggle — % Share / thousand t. */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: 10,
                  margin: "4px 0 14px",
                }}
              >
                <span
                  style={{
                    fontFamily: "Arial",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#555",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                  }}
                >
                  Unit
                </span>
                <SegmentedToggle
                  options={UNIT_OPTIONS}
                  value={unitMode}
                  onChange={setUnitMode}
                  variant="compact"
                />
              </div>

              {seriesLoading ? (
                <BarrelLoading />
              ) : (
                <>
                  {productKeys.map((p, idx) => (
                    <div key={p}>
                      {idx > 0 && (
                        <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />
                      )}
                      <div style={{ marginBottom: 10 }}>
                        <div className="section-title" style={{ color: "#1a1a1a" }}>
                          {categoryLabel(p)}
                        </div>
                        <hr className="section-hr" />
                      </div>
                      <div className="row g-3">
                        <div className="col-md-6">
                          <div className="chart-container">
                            <PlotlyChart
                              data={charts?.[p]?.data ?? []}
                              layout={charts?.[p]?.layout ?? {}}
                              config={{ displayModeBar: false }}
                              style={{ width: "100%", height: 300 }}
                            />
                            {compData && compData[p] && (
                              <ComparisonTable rows={compData[p]} unitMode={unitMode} />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
