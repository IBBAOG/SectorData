"use client";

// Desktop view for /price-bands.
//
// Consumes usePriceBandsData exclusively — no direct Supabase calls here.
// Layout: sidebar (period slider) + main content (2 sections, side-by-side charts).
//
// Binding sync rule: any new filter, chart, or KPI added here must also land
// in mobile/View.tsx in the same commit, or declare [desktop-only] with reason.

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import { ExportButton } from "@/lib/export";
import { priceBandsExport } from "@/lib/export/dashboards/priceBands";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  usePriceBandsData,
  fmtPct,
  fmtDateLabel,
  COLOR_IMPORT,
  SUBSIDY_CUTOFF,
  type PriceBandsRow,
  type PriceBandsCurrentValues,
} from "../usePriceBandsData";
import { useState } from "react";

// ─── Badge sub-component ──────────────────────────────────────────────────────

function PctBadge({ pct, vs, outlined, numerator }: { pct: number; vs: string; outlined?: boolean; numerator?: string }) {
  const sign  = pct >= 0 ? "+" : "";
  const label = numerator
    ? `${sign}${pct.toFixed(0)}% ${numerator} vs. ${vs}`
    : `${sign}${pct.toFixed(0)}% vs. ${vs}`;
  if (outlined) {
    return <span style={{ border: "1px solid #1a1a1a", color: "#1a1a1a", background: "white", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontFamily: "Arial", marginLeft: 8, fontWeight: 600 }}>{label}</span>;
  }
  return <span style={{ background: COLOR_IMPORT, color: "white", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontFamily: "Arial", marginLeft: 8, fontWeight: 600 }}>{label}</span>;
}

// ─── Chart header (product label + badges) ────────────────────────────────────

function ChartHeader({ product, cv, rows, xMax }: { product: "Gasoline" | "Diesel"; cv: PriceBandsCurrentValues; rows: PriceBandsRow[]; xMax: string | null }) {
  // Diesel: subsidy badges only from SUBSIDY_CUTOFF onwards
  const lastSubsidy = product === "Diesel"
    ? [...rows].sort((a, b) => b.date.localeCompare(a.date)).find(
        (r) => r.date >= SUBSIDY_CUTOFF && r.petrobras_price != null && r.bba_import_parity_w_subsidy != null && (!xMax || r.date <= xMax)
      )
    : null;

  return (
    <div style={{ marginTop: 16, marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 4 }}>
        <span style={{ fontFamily: "Arial", fontSize: 14, fontWeight: 700, color: "#FF5000" }}>{product}:</span>
        {cv.pctVsIpp != null && <PctBadge pct={cv.pctVsIpp} vs="IPP" />}
        {cv.pctVsIppSubsidy != null && lastSubsidy && <PctBadge pct={cv.pctVsIppSubsidy} vs="IPP w/ sub" />}
        {cv.pctPetroSubVsIppSub != null && lastSubsidy && <PctBadge pct={cv.pctPetroSubVsIppSub} vs="IPP w/ sub" numerator="Petr. w/sub" />}
        {cv.pctVsEpp != null && <PctBadge pct={cv.pctVsEpp} vs="EPP" outlined />}
        {cv.lastDate && (
          <span style={{ fontFamily: "Arial", fontSize: 11, color: "#999", marginLeft: 10 }}>
            Last data: {fmtDateLabel(cv.lastDate)}
          </span>
        )}
      </div>
      <hr style={{ borderTop: "1px solid #ccc", margin: "0 0 6px 0" }} />
    </div>
  );
}

// ─── Desktop View ─────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("price-bands");
  const {
    loading,
    filters, setFilters,
    datas, xMin, xMax,
    gasolineRows, dieselRows,
    gasolineChart, dieselChart,
    gasolineYtd, dieselYtd,
    ytdYears, ytdYear, setYtdYear,
    currentValues,
    resetFilters,
  } = usePriceBandsData();

  const [resetHovered, setResetHovered] = useState(false);

  if (visLoading || !visible) return <></>;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0" style={{ display: "flex", flexDirection: "column" }}>
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && datas.length > 0 && (
                  <PeriodSlider
                    dates={datas}
                    value={filters.sliderRange}
                    onChange={(v) => setFilters({ sliderRange: v })}
                    sliderId="pb-slider-period"
                  />
                )}
              </div>

              <div className="row g-1 mt-1">
                <div className="col-12">
                  <button
                    type="button"
                    className="btn btn-clear"
                    onClick={resetFilters}
                    disabled={loading}
                    onMouseEnter={() => setResetHovered(true)}
                    onMouseLeave={() => setResetHovered(false)}
                    style={{
                      transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                      ...(resetHovered ? { backgroundColor: "#6c6c6c", color: "#fff", borderColor: "#6c6c6c" } : {}),
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Main content ─────────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="Brazil Fuel Price Bands"
                sub="BBA Import/Export Parity vs. Petrobras reference price (R$/L)"
                lang="en"
                hideDivider
                rightSlot={<ExportButton spec={priceBandsExport} />}
              />

              {/* Section 1: Price Bands */}
              <h5 className="section-title" style={{ marginBottom: 4, color: "#000000" }}>Price Bands</h5>
              <hr className="section-hr" style={{ marginBottom: 0 }} />

              {loading ? (
                <BarrelLoading />
              ) : (
                <>
                  {/* Price Bands — side by side */}
                  <div className="row g-3">
                    <div className="col-6">
                      <ChartHeader product="Gasoline" cv={currentValues.Gasoline} rows={gasolineRows} xMax={xMax} />
                      <PlotlyChart data={gasolineChart.data} layout={gasolineChart.layout} config={{ displayModeBar: false }} />
                    </div>
                    <div className="col-6">
                      <ChartHeader product="Diesel" cv={currentValues.Diesel} rows={dieselRows} xMax={xMax} />
                      <PlotlyChart data={dieselChart.data} layout={dieselChart.layout} config={{ displayModeBar: false }} />
                      <small style={{ color: "#aaa", fontFamily: "Arial", fontSize: 10, display: "block", marginTop: 2 }}>
                        w/ subsidy lines auto-calculated from ANP daily reference price (updated daily)
                      </small>
                    </div>
                  </div>

                  {/* Section 2: YTD Average Price */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 32, marginBottom: 4 }}>
                    <h5 className="section-title" style={{ color: "#000000", marginBottom: 0 }}>YTD Average Price</h5>
                    <SegmentedToggle
                      variant="compact"
                      fontSize={13}
                      buttonPadding="14px"
                      options={ytdYears.map((y) => ({ value: y, label: String(y) }))}
                      value={ytdYear}
                      onChange={setYtdYear}
                    />
                  </div>
                  <hr className="section-hr" style={{ marginBottom: 0 }} />

                  {/* YTD — side by side */}
                  <div className="row g-3">
                    <div className="col-6">
                      <div style={{ marginTop: 16, marginBottom: 0 }}>
                        <span style={{ fontFamily: "Arial", fontSize: 14, fontWeight: 700, color: "#FF5000" }}>Gasoline</span>
                        <hr style={{ borderTop: "1px solid #ccc", margin: "4px 0 6px 0" }} />
                      </div>
                      <PlotlyChart data={gasolineYtd.data} layout={gasolineYtd.layout} config={{ displayModeBar: false }} />
                    </div>
                    <div className="col-6">
                      <div style={{ marginTop: 16, marginBottom: 0 }}>
                        <span style={{ fontFamily: "Arial", fontSize: 14, fontWeight: 700, color: "#FF5000" }}>Diesel</span>
                        <hr style={{ borderTop: "1px solid #ccc", margin: "4px 0 6px 0" }} />
                      </div>
                      <PlotlyChart data={dieselYtd.data} layout={dieselYtd.layout} config={{ displayModeBar: false }} />
                    </div>
                  </div>
                  {ytdYear === new Date().getFullYear() && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ fontFamily: "Arial", fontSize: 11, color: "#888" }}>
                        Solid: actual cumulative average · Dotted: projection assuming today&apos;s prices hold through Dec 31
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
